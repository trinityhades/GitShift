/**
 * GitShift - Contributions Webview Provider
 * Copyright (c) 2025 mikeeeyy04
 * https://github.com/mikeeeyy04/GitShift
 * 
 * MIT License - See LICENSE file for details
 */

import * as vscode from 'vscode';
import { GitHubAccount } from './types';
import { loadAccounts } from './accountManager';
import { getCurrentGitUser } from './gitManager';
import { getGitHubToken } from './githubAuth';
import { fetchNotifications, markNotificationAsRead, markAllNotificationsAsRead, GitHubNotification } from './githubNotifications';

/**
 * Provides the webview content for the contributions view
 */
export class ContributionsProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _isLoaded: boolean = false;
  private _notificationsPollingInterval?: NodeJS.Timeout;
  private _notificationsCache: GitHubNotification[] = [];
  private _lastNotificationFetch: number = 0;

  constructor(private readonly _extensionUri: vscode.Uri) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getLoadingHtml();

    // Only load content if visible (respects openOnStartup setting)
    if (webviewView.visible) {
      this._loadContent();
      this._isLoaded = true;
    } else {
      // Set up visibility listener to load when view becomes visible
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible && !this._isLoaded) {
          this._loadContent();
          this._isLoaded = true;
        } else if (webviewView.visible && this._isLoaded) {
          // Refresh notifications when view becomes visible again (for auto-refresh on visibility)
          // The HTML will handle the actual refresh via JavaScript
        }
      });
    }

    webviewView.webview.onDidReceiveMessage(async (data) => {
      try {
        switch (data.type) {
          case 'fetchContributions':
            await this._fetchContributions(data.username, data.year);
            break;
          case 'fetchNotifications':
            await this._fetchNotifications(data.username);
            break;
          case 'markNotificationAsRead':
            await this._markNotificationAsRead(data.notificationId, data.username);
            break;
          case 'markAllAsRead':
            await this._markAllNotificationsAsRead(data.username);
            break;
          case 'openNotification':
            await this._openNotification(data.url);
            break;
          case 'toggleNotificationsPolling':
            this._toggleNotificationsPolling(data.enabled, data.username);
            break;
        }
      } catch (error: any) {
        console.error('Error handling message:', error);
      }
    });
  }

  public async refresh() {
    if (this._view) {
      this._loadContent();
    }
  }

  private postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private async _loadContent() {
    if (this._view) {
      this._view.webview.html = await this._getHtmlContent();
    }
  }

  private async _fetchContributions(username: string | undefined, year?: number) {
    const outputChannel = vscode.window.createOutputChannel('GitShift');
    outputChannel.appendLine(`[Contributions] _fetchContributions called: username=${username}, year=${year}`);

    if (!username) {
      outputChannel.appendLine(`[Contributions] No username provided, returning null`);
      this.postMessage({ type: 'contributionsData', data: null });
      return;
    }

    const targetYear = year || new Date().getFullYear();
    // Query from the first Sunday before the year starts (to match GitHub's calendar layout)
    // to the first day of the next year to ensure we get all contributions
    // GitHub's calendar shows weeks starting from Sunday
    const yearStart = new Date(`${targetYear}-01-01T00:00:00Z`);
    const dayOfWeek = yearStart.getUTCDay(); // 0 = Sunday, 6 = Saturday
    // Calculate days to subtract to get to the previous Sunday (or stay on Sunday if dayOfWeek is 0)
    const daysToSubtract = dayOfWeek === 0 ? 0 : dayOfWeek;
    yearStart.setUTCDate(yearStart.getUTCDate() - daysToSubtract);

    const startDate = yearStart.toISOString();
    const endDate = `${targetYear + 1}-01-01T00:00:00Z`; // First day of next year
    outputChannel.appendLine(`[Contributions] Query date range: ${startDate} to ${endDate}`);

    try {
      // Get token for authentication
      const token = await getGitHubToken(username);
      if (!token) {
        throw new Error('Authentication required. Please add a token for this account.');
      }

      // Use GitHub GraphQL API to get contribution data
      // Query all contribution types to get accurate total
      const query = `
        query($username: String!, $from: DateTime!, $to: DateTime!) {
          user(login: $username) {
            contributionsCollection(from: $from, to: $to) {
              totalCommitContributions
              totalIssueContributions
              totalPullRequestContributions
              totalPullRequestReviewContributions
              totalRepositoryContributions
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    date
                    contributionCount
                    color
                  }
                  firstDay
                }
              }
            }
          }
        }
      `;

      const variables = {
        username: username,
        from: startDate,
        to: endDate
      };

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'VSCode-GitShift'
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error: ${response.status} ${errorText}`);
      }

      const result = await response.json() as {
        errors?: Array<{ message: string }>;
        data?: {
          user?: {
            contributionsCollection?: {
              totalCommitContributions: number;
              totalIssueContributions: number;
              totalPullRequestContributions: number;
              totalPullRequestReviewContributions: number;
              totalRepositoryContributions: number;
              contributionCalendar?: {
                totalContributions: number;
                weeks: Array<{
                  contributionDays: Array<{
                    date: string;
                    contributionCount: number;
                    color: string;
                  }>;
                  firstDay: string;
                }>;
              };
            };
          };
        };
      };

      if (result.errors) {
        const errorMessage = result.errors[0]?.message || 'Unknown error';

        // Check for permission-related errors
        if (errorMessage.includes('requires') && errorMessage.includes('read:user')) {
          throw new Error('Insufficient permissions: Your Personal Access Token needs the "read:user" scope. Please update your token with this scope and try again.');
        } else if (errorMessage.includes('resource not accessible') || errorMessage.includes('permission')) {
          throw new Error('Permission denied: Your token may be missing required scopes. Ensure your Personal Access Token has the "read:user" scope enabled.');
        }

        throw new Error(`GraphQL error: ${errorMessage}`);
      }

      if (!result.data || !result.data.user) {
        throw new Error('User not found or no contribution data available');
      }

      const contributionsCollection = result.data.user.contributionsCollection;
      const calendar = contributionsCollection?.contributionCalendar;

      if (!calendar) {
        throw new Error('No contribution calendar data available');
      }

      // Calculate total from all contribution types
      const totalCommits = contributionsCollection?.totalCommitContributions || 0;
      const totalIssues = contributionsCollection?.totalIssueContributions || 0;
      const totalPRs = contributionsCollection?.totalPullRequestContributions || 0;
      const totalReviews = contributionsCollection?.totalPullRequestReviewContributions || 0;
      const totalRepos = contributionsCollection?.totalRepositoryContributions || 0;
      const calendarTotal = calendar.totalContributions || 0;

      const comprehensiveTotal = totalCommits + totalIssues + totalPRs + totalReviews + totalRepos;

      // Debug: Log calendar structure info
      outputChannel.appendLine(`[Contributions] Successfully received calendar data`);
      outputChannel.appendLine(`[Contributions] Calendar has ${calendar.weeks.length} weeks`);
      outputChannel.appendLine(`[Contributions] Breakdown: Commits=${totalCommits}, Issues=${totalIssues}, PRs=${totalPRs}, Reviews=${totalReviews}, Repos=${totalRepos}`);
      outputChannel.appendLine(`[Contributions] Comprehensive total: ${comprehensiveTotal}`);
      outputChannel.appendLine(`[Contributions] Calendar totalContributions: ${calendarTotal}`);

      // Extract contribution data - include ALL days from the calendar
      // The calendar.weeks structure contains the full contribution graph data
      const allDays: Array<{ date: string; count: number }> = [];
      let totalContributions = 0;
      let totalDaysInYear = 0;
      let totalDaysWithContributions = 0;
      let totalDaysInAllWeeks = 0;

      calendar.weeks.forEach((week, weekIndex) => {
        totalDaysInAllWeeks += week.contributionDays.length;
        week.contributionDays.forEach((day, dayIndex) => {
          // Get date string (format: YYYY-MM-DD)
          const dayDate = day.date.includes('T') ? day.date.split('T')[0] : day.date;
          const count = day.contributionCount || 0;

          // Log first few days with non-zero contributions for debugging
          if (count > 0) {
            outputChannel.appendLine(`[Contributions] Contribution found: Week ${weekIndex}, Day ${dayIndex}: date=${dayDate}, count=${count}`);
          }
          if (weekIndex < 2 && dayIndex < 7) {
            outputChannel.appendLine(`[Contributions] Week ${weekIndex}, Day ${dayIndex}: date=${dayDate}, count=${count}`);
          }

          // Filter to only include days in the target year
          if (dayDate.startsWith(`${targetYear}-`)) {
            totalDaysInYear++;
            totalContributions += count; // Sum all contributions
            if (count > 0) totalDaysWithContributions++;
            allDays.push({ date: dayDate, count });
          }
        });
      });

      outputChannel.appendLine(`[Contributions] Total days in all weeks: ${totalDaysInAllWeeks}`);
      outputChannel.appendLine(`[Contributions] Filtered ${totalDaysInYear} days in year ${targetYear}`);
      outputChannel.appendLine(`[Contributions] Days with contributions: ${totalDaysWithContributions}`);
      outputChannel.appendLine(`[Contributions] Calculated sum: ${totalContributions}`);
      outputChannel.appendLine(`[Contributions] API totalContributions: ${calendar.totalContributions}`);

      // Use the comprehensive total which includes all contribution types
      // This should match what GitHub shows on the profile page
      // The calendar totalContributions might only include commits visible on the calendar
      let total: number;
      let needsReadUserScope = false;

      outputChannel.appendLine(`[Contributions] Comparison: Comprehensive total=${comprehensiveTotal}, Calendar total=${calendarTotal}, Calculated from days=${totalContributions}`);

      // Check if we might be missing data due to missing read:user scope
      // Signs that read:user is missing:
      // 1. Comprehensive total is 0 or very low (only seeing private repos)
      // 2. Calendar total is much lower than expected for an active user
      // 3. We're only getting contributions from private repositories (can't easily detect, but low totals suggest it)

      if (comprehensiveTotal === 0 && totalContributions === 0 && calendarTotal === 0) {
        // No data at all - might be missing read:user scope
        needsReadUserScope = true;
        outputChannel.appendLine(`[Contributions] WARNING: No contributions found - token may be missing read:user scope`);
      } else if (calendarTotal > 0 && comprehensiveTotal === 0) {
        // Calendar has data but comprehensive breakdown is 0 - likely missing read:user
        needsReadUserScope = true;
        outputChannel.appendLine(`[Contributions] WARNING: Comprehensive total is 0 but calendar has data - likely missing read:user scope`);
      }

      // Use the comprehensive total if it's significantly higher than calendar total
      // Otherwise use calendar total, but prioritize comprehensive total for accuracy
      if (comprehensiveTotal > calendarTotal && comprehensiveTotal > 0) {
        total = comprehensiveTotal;
        outputChannel.appendLine(`[Contributions] Using comprehensive total (${total}) - includes all contribution types`);
      } else if (calendarTotal > totalContributions) {
        // Calendar total might include contributions not in our filtered days (partial weeks, etc.)
        total = calendarTotal;
        outputChannel.appendLine(`[Contributions] Using calendar total (${total}) - API server-calculated value`);
      } else {
        // Use our calculated sum which is filtered to the exact year
        total = totalContributions;
        outputChannel.appendLine(`[Contributions] Using calculated sum (${total}) for year ${targetYear}`);
      }

      // If we suspect missing read:user scope, add a warning to the response
      if (needsReadUserScope) {
        outputChannel.appendLine(`[Contributions] NOTE: Token may be missing read:user scope. Without it, you may only see contributions from private repositories.`);
      }


      // Calculate levels based on quartiles (GitHub's approach)
      // Sort descending to find percentiles
      const sortedCounts = allDays.map(d => d.count).sort((a, b) => b - a);
      const nonZeroCounts = sortedCounts.filter(c => c > 0);

      // Calculate quartiles for level distribution
      // Q3 = 75th percentile (top 25%), Q2 = 50th percentile (median), Q1 = 25th percentile (bottom 25%)
      let q3 = 0, q2 = 0, q1 = 0;
      if (nonZeroCounts.length > 0) {
        // Get the value at the 75th percentile (top quartile)
        q3 = nonZeroCounts[Math.floor(nonZeroCounts.length * 0.25)] || 0;
        // Get the median (50th percentile)
        q2 = nonZeroCounts[Math.floor(nonZeroCounts.length * 0.5)] || 0;
        // Get the 25th percentile (bottom quartile)
        q1 = nonZeroCounts[Math.floor(nonZeroCounts.length * 0.75)] || 0;
      }

      const contributions: Array<{ date: string; count: number; level: number }> = [];

      allDays.forEach((day) => {
        let level = 0;
        if (day.count > 0) {
          // Level 4: highest contributions (top 25%)
          // Level 3: high contributions (50th-75th percentile)
          // Level 2: medium contributions (25th-50th percentile)
          // Level 1: low contributions (bottom 25%)
          if (day.count >= q3) level = 4;
          else if (day.count >= q2) level = 3;
          else if (day.count >= q1) level = 2;
          else level = 1;
        }
        contributions.push({ date: day.date, count: day.count, level });
      });

      // Generate SVG from contribution data
      const svg = this._generateContributionSVG(contributions, targetYear);

      // Send data to webview with breakdown
      this.postMessage({
        type: 'contributionsData',
        data: {
          svg,
          contributions: contributions.map(c => ({ date: c.date, level: c.level.toString() })),
          total,
          username,
          year: targetYear,
          needsReadUserScope, // Flag to show warning in UI
          breakdown: {
            commits: totalCommits,
            issues: totalIssues,
            pullRequests: totalPRs,
            reviews: totalReviews,
            repositories: totalRepos
          },
          stats: {
            totalDays: totalDaysInYear,
            daysWithContributions: totalDaysWithContributions,
            averagePerDay: totalDaysWithContributions > 0 ? (total / totalDaysWithContributions).toFixed(1) : 0
          }
        }
      });
    } catch (error: any) {
      outputChannel.appendLine(`[Contributions] Error: ${error.message}`);

      // Show a helpful error message if it's a permission issue
      if (error.message.includes('read:user') || error.message.includes('Permission') || error.message.includes('permission')) {
        outputChannel.appendLine(`[Contributions] To fix this: Go to GitHub Settings > Developer settings > Personal access tokens > Tokens (classic), edit your token, and enable the "read:user" scope.`);

        // Send error message with instructions
        this.postMessage({
          type: 'contributionsData',
          data: null,
          error: `${error.message}\n\nTo fix: Update your Personal Access Token to include the "read:user" scope.\nGo to: GitHub Settings > Developer settings > Personal access tokens`
        });
      } else {
        this.postMessage({
          type: 'contributionsData',
          data: null,
          error: error.message
        });
      }
    }
  }

  private _generateContributionSVG(contributions: Array<{ date: string; count: number; level: number }>, year: number): string {
    // Create a map of date to contribution data for quick lookup
    const contributionMap = new Map<string, { count: number; level: number }>();
    contributions.forEach(c => {
      contributionMap.set(c.date, { count: c.count, level: c.level });
    });

    // Find the date range from contributions
    const dates = contributions.map(c => c.date).sort();
    if (dates.length === 0) {
      return `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" text-anchor="middle" fill="var(--vscode-foreground)">No data</text></svg>`;
    }

    // Dates are calculated but not currently used - kept for potential future use
    // const firstDate = new Date(dates[0]);
    // const lastDate = new Date(dates[dates.length - 1]);

    // Calculate weeks - GitHub starts from the Sunday before the first day of the year
    const startDate = new Date(`${year}-01-01`);
    const firstDayOfYear = startDate.getDay(); // 0 = Sunday, 6 = Saturday
    const startOffset = firstDayOfYear; // Offset to align to Sunday

    // Calculate total days in year and weeks
    const endDate = new Date(`${year}-12-31`);
    const daysInYear = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const totalWeeks = Math.ceil((startOffset + daysInYear) / 7);

    // Month labels - find which week each month starts in
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthStarts: Array<{ month: string; week: number }> = [];

    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(year, i, 1);
      const dayOfYear = Math.floor((monthDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const week = Math.floor((startOffset + dayOfYear) / 7);
      // Only add if this month's week is different from previous month (avoid duplicates)
      if (i === 0 || monthStarts[monthStarts.length - 1].week !== week) {
        monthStarts.push({ month: months[i], week });
      }
    }

    // Generate SVG
    const cellSize = 10;
    const cellGap = 2;
    const padding = 20;
    const monthLabelHeight = 15;
    const dayLabelWidth = 20;

    const width = totalWeeks * (cellSize + cellGap) + dayLabelWidth + padding * 2;
    const height = 7 * (cellSize + cellGap) + monthLabelHeight + padding * 2;

    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

    // Add month labels
    monthStarts.forEach(({ month, week }) => {
      const x = dayLabelWidth + padding + week * (cellSize + cellGap);
      svg += `<text x="${x}" y="${monthLabelHeight}" fill="var(--vscode-foreground)" font-size="11" font-family="system-ui, -apple-system, sans-serif">${month}</text>`;
    });

    // Add day labels (Sunday=0, so we show Mon, Wed, Fri which are indices 1, 3, 5)
    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    dayLabels.forEach((label, i) => {
      if (label) {
        const y = monthLabelHeight + padding + i * (cellSize + cellGap) + cellSize / 2 + 3;
        svg += `<text x="${dayLabelWidth - 5}" y="${y}" text-anchor="end" fill="var(--vscode-foreground)" font-size="10" font-family="system-ui, -apple-system, sans-serif">${label}</text>`;
      }
    });

    // Add contribution squares - iterate through weeks and days
    for (let week = 0; week < totalWeeks; week++) {
      for (let day = 0; day < 7; day++) {
        // Calculate which day of the year this square represents
        const dayIndex = week * 7 + day - startOffset;

        if (dayIndex >= 0 && dayIndex < daysInYear) {
          const currentDate = new Date(startDate);
          currentDate.setDate(currentDate.getDate() + dayIndex);
          const dateStr = currentDate.toISOString().split('T')[0];

          const contribution = contributionMap.get(dateStr);
          const level = contribution?.level || 0;
          const count = contribution?.count || 0;

          const x = dayLabelWidth + padding + week * (cellSize + cellGap);
          const y = monthLabelHeight + padding + day * (cellSize + cellGap);

          // GitHub's standard green colors (dark theme adapted)
          // Level 0: empty (#161b22 for dark theme), Level 1-4: green gradient
          const colors = ['#161b22', '#c6e48b', '#7bc96f', '#239a3b', '#196127'];
          const fill = colors[level];

          svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${fill}" rx="2" ry="2" data-date="${dateStr}" data-level="${level}" data-count="${count}"/>`;
        }
      }
    }

    svg += `</svg>`;
    return svg;
  }

  private async _fetchNotifications(username: string | undefined) {
    if (!username) {
      this.postMessage({ type: 'notificationsData', data: null });
      return;
    }

    try {
      const token = await getGitHubToken(username);
      if (!token) {
        this.postMessage({ type: 'notificationsData', data: null });
        return;
      }

      const notifications = await fetchNotifications(token);
      this._notificationsCache = notifications;
      this._lastNotificationFetch = Date.now();

      this.postMessage({ type: 'notificationsData', data: notifications });
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      this.postMessage({ type: 'notificationsData', data: null, error: error.message });
    }
  }

  private async _markNotificationAsRead(notificationId: string, username: string | undefined) {
    if (!username) {
      return;
    }

    try {
      const token = await getGitHubToken(username);
      if (!token) {
        return;
      }

      await markNotificationAsRead(token, notificationId);

      // Refresh notifications list
      await this._fetchNotifications(username);
    } catch (error: any) {
      console.error('Error marking notification as read:', error);
      vscode.window.showErrorMessage(`Failed to mark notification as read: ${error.message}`);
    }
  }

  private async _markAllNotificationsAsRead(username: string | undefined) {
    if (!username) {
      return;
    }

    try {
      const token = await getGitHubToken(username);
      if (!token) {
        return;
      }

      await markAllNotificationsAsRead(token);

      // Refresh notifications list
      await this._fetchNotifications(username);
    } catch (error: any) {
      console.error('Error marking all notifications as read:', error);
      vscode.window.showErrorMessage(`Failed to mark all notifications as read: ${error.message}`);
    }
  }

  private async _openNotification(url: string) {
    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error: any) {
      console.error('Error opening notification:', error);
      vscode.window.showErrorMessage(`Failed to open notification: ${error.message}`);
    }
  }

  private _toggleNotificationsPolling(enabled: boolean, username: string | undefined) {
    // Clear existing polling interval
    if (this._notificationsPollingInterval) {
      clearInterval(this._notificationsPollingInterval);
      this._notificationsPollingInterval = undefined;
    }

    // Start new polling if enabled
    if (enabled && username) {
      this._notificationsPollingInterval = setInterval(async () => {
        await this._fetchNotifications(username);
      }, 2 * 60 * 1000); // Poll every 2 minutes
    }
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      background: transparent;
      color: var(--vscode-foreground);
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
    }

    .loading-container {
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .loading-spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-foreground);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-bottom: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <div>Loading contributions...</div>
  </div>
</body>
</html>`;
  }

  private async _getHtmlContent(): Promise<string> {
    let accounts: GitHubAccount[] = [];
    let currentUser: { name: string; email: string } | null = null;
    let currentAccount: GitHubAccount | null = null;

    try {
      accounts = await loadAccounts();
      currentUser = await getCurrentGitUser();

      // Find the current account from accounts list
      if (currentUser) {
        currentAccount = accounts.find(acc =>
          acc.name === currentUser!.name && acc.email === currentUser!.email
        ) || null;
      }
    } catch (error) {
      console.error('Error loading data for contributions:', error);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css" rel="stylesheet" />
  <title>Contributions</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      background: transparent;
      color: var(--vscode-foreground);
      padding: 12px;
      font-size: 13px;
      line-height: 1.5;
    }

    .codicon[class*='codicon-'] {
      font-size: 14px !important;
    }

    .section {
      margin-bottom: 16px;
    }

    .section-header {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .section-header i {
      font-size: 14px;
      opacity: 0.8;
    }

    .section-header > div:first-child {
      flex: 1;
      min-width: 0;
    }

    .account-header {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.2s ease;
    }

    .account-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 2px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .account-info {
      flex: 1;
      min-width: 0;
    }

    .account-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .account-username {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }

    .stat-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      text-align: center;
      transition: all 0.2s ease;
      cursor: default;
    }

    .stat-card:hover {
      border-color: var(--vscode-focusBorder);
      transform: translateY(-1px);
    }

    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
      line-height: 1.2;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .stat-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .stat-icon {
      font-size: 14px;
      opacity: 0.8;
    }

    .graph-container {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .graph-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .graph-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .graph-title i {
      font-size: 14px;
      opacity: 0.8;
    }

    .year-selector {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .year-select {
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      color: var(--vscode-foreground);
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      transition: all 0.15s ease;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 8px center;
      background-size: 14px;
      padding-right: 32px;
    }

    .year-select:hover {
      background-color: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .year-select:focus {
      border-color: var(--vscode-focusBorder);
    }

    .year-select option {
      background: var(--vscode-dropdown-background) !important;
      color: var(--vscode-foreground) !important;
      padding: 4px 8px;
    }

    .total-contributions {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .total-contributions i {
      font-size: 14px;
      opacity: 0.8;
    }

    .svg-wrapper {
      overflow-x: auto;
      overflow-y: hidden;
      width: 100%;
      -webkit-overflow-scrolling: touch;
      max-width: 100%;
      min-width: 0;
      margin-bottom: 12px;
    }

    /* Custom scrollbar matching other webviews */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
      transition: background 0.2s ease;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }

    ::-webkit-scrollbar-thumb:active {
      background: var(--vscode-scrollbarSlider-activeBackground);
    }

    /* Firefox */
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
    }

    .legend {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-wrap: wrap;
    }

    .legend-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .legend-square {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      display: inline-block;
    }

    .loading {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }

    .loading-spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-foreground);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-bottom: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      padding: 12px;
      color: var(--vscode-errorForeground);
    }

    .error-title {
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }

    .error-title i {
      font-size: 14px;
    }

    .error-message {
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .warning-banner {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 12px;
      line-height: 1.6;
    }

    .warning-title {
      font-weight: 600;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-notificationsWarningIcon-foreground);
      font-size: 13px;
    }

    .warning-title i {
      font-size: 14px;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    svg rect {
      transition: all 0.15s ease;
      cursor: pointer;
    }

    svg rect:hover {
      stroke: var(--vscode-focusBorder);
      stroke-width: 2;
      filter: brightness(1.1);
    }

    .tooltip {
      position: fixed;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 11px;
      line-height: 1.5;
      pointer-events: none;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      display: none;
      white-space: normal;
      max-width: 280px;
      text-align: center;
    }

    .tooltip.visible {
      display: block;
    }

    .breakdown-section {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .breakdown-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .breakdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      background: var(--vscode-sideBar-background);
      border-radius: 4px;
      transition: all 0.15s ease;
      cursor: default;
    }

    .breakdown-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .breakdown-icon {
      font-size: 16px;
      width: 20px;
      text-align: center;
      opacity: 0.8;
    }

    .breakdown-content {
      flex: 1;
      min-width: 0;
    }

    .breakdown-value {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      line-height: 1.2;
    }

    .breakdown-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 500;
    }

    .notification-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: 600;
      margin-left: 8px;
    }

    .notification-item {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-focusBorder);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .notification-item.read {
      opacity: 0.6;
      border-left-color: var(--vscode-panel-border);
    }

    .notification-item:hover {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
    }

    .notification-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .notification-title {
      font-weight: 600;
      color: var(--vscode-foreground);
      flex: 1;
      font-size: 13px;
      min-width: 0;
      word-break: break-word;
    }

    .notification-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-wrap: wrap;
      width: 100%;
      margin-top: 4px;
    }

    .notification-meta > * {
      flex-shrink: 0;
    }

    .notification-reason {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 3px;
      font-size: 10px;
      font-weight: 500;
      white-space: nowrap;
    }

    .notification-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .notification-btn {
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 500;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .notification-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .notification-btn:active {
      transform: scale(0.96);
    }

    .notification-settings {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      margin-bottom: 12px;
      gap: 12px;
      flex-wrap: wrap;
    }

    .notification-settings > label {
      flex-shrink: 0;
    }

    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      transition: 0.3s;
      border-radius: 20px;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 12px;
      width: 12px;
      left: 3px;
      bottom: 3px;
      background-color: var(--vscode-foreground);
      transition: 0.3s;
      border-radius: 50%;
    }

    input:checked + .toggle-slider {
      background-color: var(--vscode-button-background);
    }

    input:checked + .toggle-slider:before {
      transform: translateX(20px);
    }

    .icon-btn {
      width: 28px;
      height: 28px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: all 0.15s ease;
      flex-shrink: 0;
      padding: 0;
    }

    .icon-btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .icon-btn:active {
      transform: scale(0.96);
    }

    .icon-btn.loading {
      pointer-events: none;
    }

    .icon-btn.loading i {
      animation: spin 0.6s linear infinite;
    }

    .btn-small {
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 500;
      width: auto;
      height: auto;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">
      <div class="loading-spinner"></div>
      <div>Loading contributions...</div>
    </div>
  </div>
  <div class="tooltip" id="tooltip"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentContributionsUsername = null;
    const accounts = ${JSON.stringify(accounts)};
    const currentAccount = ${JSON.stringify(currentAccount)};
    let tooltip = null;

    // Initialize tooltip
    function initTooltip() {
      tooltip = document.getElementById('tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'tooltip';
        tooltip.className = 'tooltip';
        document.body.appendChild(tooltip);
      }
    }

    // Show tooltip with proper positioning
    function showTooltip(text, eventOrRect) {
      if (!tooltip) initTooltip();
      
      // Handle both event and rect objects
      let clientX, clientY;
      if (eventOrRect instanceof MouseEvent) {
        clientX = eventOrRect.clientX;
        clientY = eventOrRect.clientY;
      } else if (eventOrRect && typeof eventOrRect.left !== 'undefined') {
        // It's a DOMRect
        clientX = eventOrRect.left + eventOrRect.width / 2;
        clientY = eventOrRect.top;
      } else {
        return;
      }
      
      // Set tooltip content - text may already contain <br> from template
      tooltip.innerHTML = typeof text === 'string' ? text.replace(/\\n/g, '<br>') : text;
      tooltip.classList.add('visible');
      
      // Force a reflow to get accurate dimensions
      void tooltip.offsetWidth;
      
      // Calculate tooltip position relative to viewport
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const tooltipWidth = tooltipRect.width || 200;
      const tooltipHeight = tooltipRect.height || 60;
      const offset = 12;
      
      // Position horizontally - center on x, but keep in viewport
      let left = clientX - tooltipWidth / 2;
      if (left < offset) left = offset;
      if (left + tooltipWidth > viewportWidth - offset) {
        left = viewportWidth - tooltipWidth - offset;
      }
      
      // Position vertically - above the element
      let top = clientY - tooltipHeight - offset;
      if (top < offset) {
        // If not enough space above, show below
        top = clientY + offset;
      }
      
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    // Hide tooltip
    function hideTooltip() {
      if (tooltip) {
        tooltip.classList.remove('visible');
      }
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'contributionsData') {
        updateContributionsGraph(message.data, message.error);
      } else if (message.type === 'notificationsData') {
        updateNotificationsDisplay(message.data, message.error);
      }
    });

    // Notifications functions
    let notificationsPollingEnabled = false;

    function fetchNotifications(username) {
      vscode.postMessage({ type: 'fetchNotifications', username });
    }

    function markNotificationAsRead(notificationId, username) {
      vscode.postMessage({ type: 'markNotificationAsRead', notificationId, username });
    }

    function markAllAsRead(username) {
      vscode.postMessage({ type: 'markAllAsRead', username });
    }

    function openNotification(url, notificationId, username) {
      vscode.postMessage({ type: 'openNotification', url });
      if (notificationId) {
        markNotificationAsRead(notificationId, username);
      }
    }

    function toggleNotificationsPolling(enabled, username) {
      notificationsPollingEnabled = enabled;
      vscode.postMessage({ type: 'toggleNotificationsPolling', enabled, username });
    }

    function updateNotificationsDisplay(data, error) {
      const container = document.getElementById('notificationsContainer');
      const badge = document.getElementById('notificationCount');
      
      if (!container || !badge) return;
      
      if (error) {
        const isPermissionError = error.includes('Insufficient permissions') || error.includes('notifications scope');
        container.innerHTML = \`
          <div class="error">
            <div class="error-title">
              <i class="codicon codicon-error"></i>
              Failed to load notifications
            </div>
            <div class="error-message">\${escapeHtml(error)}</div>
            \${isPermissionError ? \`
              <div style="margin-top: 12px; padding: 12px; background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 4px;">
                <div style="font-weight: 500; margin-bottom: 6px;">To enable notifications:</div>
                <ol style="margin: 4px 0; padding-left: 20px; font-size: 11px; line-height: 1.6;">
                  <li>Go to Command Palette (Ctrl+Shift+P / Cmd+Shift+P)</li>
                  <li>Run: "GitHub: Sign In with GitHub"</li>
                  <li>Grant notification permissions when prompted</li>
                </ol>
              </div>
            \` : ''}
          </div>
        \`;
        badge.style.display = 'none';
        return;
      }
      
      if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state">No notifications</div>';
        badge.style.display = 'none';
        return;
      }
      
      const unreadCount = data.filter(n => n.unread).length;
      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
      
      // Build notification list HTML
      const notificationsHtml = data.map(notification => {
        const reasonIcons = {
          mention: 'mention',
          review_requested: 'git-pull-request',
          comment: 'comment',
          ci_activity: 'check',
          release: 'tag',
          assign: 'person',
          author: 'edit',
          manual: 'bell',
          state_change: 'arrow-swap',
          team_mention: 'organization',
          security_alert: 'warning',
          unknown: 'bell'
        };
        const icon = reasonIcons[notification.reason] || 'bell';
        const readClass = notification.unread ? '' : 'read';
        
        return \`
          <div class="notification-item \${readClass}" data-id="\${notification.id}">
            <div class="notification-header">
              <div class="notification-title">\${escapeHtml(notification.subject.title)}</div>
              <div class="notification-reason">
                <i class="codicon codicon-\${icon}"></i>
                \${notification.reason.replace(/_/g, ' ')}
              </div>
            </div>
            <div class="notification-meta">
              <i class="codicon codicon-repo"></i>
              \${escapeHtml(notification.repository.full_name)}
              <span>•</span>
              <i class="codicon codicon-\${notification.subject.type === 'PullRequest' ? 'git-pull-request' : notification.subject.type === 'Issue' ? 'issue-opened' : 'code'}"></i>
              \${notification.subject.type}
              <span>•</span>
              \${new Date(notification.updated_at).toLocaleString()}
            </div>
            <div class="notification-actions">
              <button class="notification-btn" onclick="openNotification('\${escapeHtml(notification.subject.url)}', '\${escapeHtml(notification.id)}', '\${escapeHtml(currentContributionsUsername)}')">
                <i class="codicon codicon-link-external"></i> Open
              </button>
              \${notification.unread ? \`
                <button class="notification-btn" onclick="markNotificationAsRead('\${escapeHtml(notification.id)}', '\${escapeHtml(currentContributionsUsername)}')">
                  <i class="codicon codicon-check"></i> Mark as Read
                </button>
              \` : ''}
            </div>
          </div>
        \`;
      }).join('');
      
      container.innerHTML = \`
        <div class="notification-settings">
          <span style="font-size: 12px;">Auto-refresh notifications</span>
          <label class="toggle-switch">
            <input type="checkbox" \${notificationsPollingEnabled ? 'checked' : ''} 
                   onchange="toggleNotificationsPolling(this.checked, currentContributionsUsername)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        \${unreadCount > 0 ? \`
          <button class="notification-btn" style="margin-bottom: 12px; width: 100%;" 
                  onclick="markAllAsRead('\${escapeHtml(currentContributionsUsername)}')">
            <i class="codicon codicon-check-all"></i> Mark All as Read
          </button>
        \` : ''}
        \${notificationsHtml}
      \`;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Update contributions based on account
    function updateContributionsForAccount(account) {
      if (account && account.username) {
        const currentYear = new Date().getFullYear();
        fetchContributions(account.username, currentYear);
        // Fetch notifications immediately when account is available
        fetchNotifications(account.username);
      } else {
        updateContributionsGraph(null);
        // Try to fetch notifications even without account (will fail gracefully if no user)
        const username = currentContributionsUsername || (currentAccount?.username);
        if (username) {
          fetchNotifications(username);
        }
      }
    }

    // Fetch contributions for a user and year
    function fetchContributions(username, year) {
      currentContributionsUsername = username;
      
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = \`
          <div class="loading">
            <div class="loading-spinner"></div>
            <div>Loading contributions...</div>
          </div>
        \`;
      }
      
      const message = { type: 'fetchContributions', username, year: year || new Date().getFullYear() };
      vscode.postMessage(message);
    }

    // Handle year change
    function changeYear(year) {
      if (currentContributionsUsername) {
        fetchContributions(currentContributionsUsername, parseInt(year, 10));
      } else if (currentAccount && currentAccount.username) {
        fetchContributions(currentAccount.username, parseInt(year, 10));
      }
    }

    // Format number with commas
    function formatNumber(num) {
      return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    }

    // Update contribution graph display
    function updateContributionsGraph(data, error) {
      const root = document.getElementById('root');
      if (!root) {
        return;
      }

      if (error || !data || !data.svg) {
        let errorHtml = '';
        if (error) {
          const isPermissionError = error.includes('read:user') || error.includes('Permission') || error.includes('token');
          
          errorHtml = \`
            <div class="error">
              <div class="error-title">
                <i class="codicon codicon-error"></i>
                Failed to load contributions
              </div>
              <div class="error-message">\${error}</div>
              \${isPermissionError ? \`
                <div style="margin-top: 12px; padding: 12px; background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 4px;">
                  <div style="font-weight: 500; margin-bottom: 6px;">How to fix:</div>
                  <ol style="margin: 4px 0; padding-left: 20px; font-size: 11px; line-height: 1.6;">
                    <li>Go to <a href="https://github.com/settings/tokens" target="_blank" style="color: var(--vscode-textLink-foreground); text-decoration: underline;">GitHub Settings > Developer settings > Personal access tokens</a></li>
                    <li>Edit your token (or create a new one with "read:user" scope)</li>
                    <li>Enable the <strong>"read:user"</strong> scope</li>
                    <li>Save the token and update it in this extension</li>
                  </ol>
                </div>
              \` : ''}
            </div>
          \`;
        } else {
          errorHtml = \`
            <div class="empty-state">
              <div class="empty-icon"><i class="codicon codicon-graph"></i></div>
              <div>No contribution data available</div>
            </div>
          \`;
        }
        root.innerHTML = errorHtml;
        return;
      }

      // Build the professional UI
      const currentYear = data.year || new Date().getFullYear();
      const startYear = 2010;
      const endYear = new Date().getFullYear();
      const years = [];
      for (let y = endYear; y >= startYear; y--) {
        years.push(y);
      }
      
      const yearOptions = years.map(y => 
        \`<option value="\${y}" \${y === currentYear ? 'selected' : ''}>\${y}</option>\`
      ).join('');

      const account = currentAccount || (data.username ? { username: data.username, name: data.username, avatarUrl: null } : null);
      const avatarHtml = account && account.avatarUrl 
        ? \`<img src="\${account.avatarUrl}" alt="\${account.name || account.username}" class="account-avatar" />\`
        : \`<div class="account-avatar" style="background: var(--vscode-button-background); display: flex; align-items: center; justify-content: center; color: var(--vscode-button-foreground); font-weight: 600;">\${(account?.name || account?.username || '?')[0].toUpperCase()}</div>\`;

      const breakdown = data.breakdown || {};
      const stats = data.stats || {};
      const total = data.total || 0;

      let warningHtml = '';
      if (data.needsReadUserScope) {
        warningHtml = \`
          <div class="warning-banner">
            <div class="warning-title">
              <i class="codicon codicon-warning"></i>
              Limited Data Detected
            </div>
            <div>
              You may only be seeing contributions from private repositories. To see all contributions (including public repos), enable the <strong>"read:user"</strong> scope in your <a href="https://github.com/settings/tokens" target="_blank" style="color: var(--vscode-textLink-foreground); text-decoration: underline;">Personal Access Token</a>.
            </div>
          </div>
        \`;
      }

      root.innerHTML = \`
        \${warningHtml}
        \${account ? \`
          <div class="account-header">
            \${avatarHtml}
            <div class="account-info">
              <div class="account-name">\${account.name || account.username || 'Unknown'}</div>
              <div class="account-username">@\${account.username || 'unknown'}</div>
            </div>
          </div>
        \` : ''}
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value"><i class="codicon codicon-graph stat-icon"></i>\${formatNumber(total)}</div>
            <div class="stat-label">Total</div>
          </div>
          \${stats.daysWithContributions !== undefined ? \`
            <div class="stat-card">
              <div class="stat-value">\${stats.daysWithContributions}</div>
              <div class="stat-label">Active Days</div>
            </div>
          \` : ''}
          \${stats.averagePerDay ? \`
            <div class="stat-card">
              <div class="stat-value">\${stats.averagePerDay}</div>
              <div class="stat-label">Avg / Day</div>
            </div>
          \` : ''}
        </div>
        \${breakdown.commits !== undefined || breakdown.pullRequests !== undefined || breakdown.issues !== undefined ? \`
          <div class="breakdown-section">
            <div class="section-header">
              <i class="codicon codicon-package"></i>
              Contribution Breakdown
            </div>
            <div class="breakdown-grid">
              \${breakdown.commits !== undefined ? \`
                <div class="breakdown-item">
                  <div class="breakdown-icon"><i class="codicon codicon-git-commit"></i></div>
                  <div class="breakdown-content">
                    <div class="breakdown-value">\${formatNumber(breakdown.commits)}</div>
                    <div class="breakdown-label">Commits</div>
                  </div>
                </div>
              \` : ''}
              \${breakdown.pullRequests !== undefined ? \`
                <div class="breakdown-item">
                  <div class="breakdown-icon"><i class="codicon codicon-git-pull-request"></i></div>
                  <div class="breakdown-content">
                    <div class="breakdown-value">\${formatNumber(breakdown.pullRequests)}</div>
                    <div class="breakdown-label">Pull Requests</div>
                  </div>
                </div>
              \` : ''}
              \${breakdown.issues !== undefined ? \`
                <div class="breakdown-item">
                  <div class="breakdown-icon"><i class="codicon codicon-issue-opened"></i></div>
                  <div class="breakdown-content">
                    <div class="breakdown-value">\${formatNumber(breakdown.issues)}</div>
                    <div class="breakdown-label">Issues</div>
                  </div>
                </div>
              \` : ''}
              \${breakdown.reviews !== undefined ? \`
                <div class="breakdown-item">
                  <div class="breakdown-icon"><i class="codicon codicon-eye"></i></div>
                  <div class="breakdown-content">
                    <div class="breakdown-value">\${formatNumber(breakdown.reviews)}</div>
                    <div class="breakdown-label">Reviews</div>
                  </div>
                </div>
              \` : ''}
              \${breakdown.repositories !== undefined ? \`
                <div class="breakdown-item">
                  <div class="breakdown-icon"><i class="codicon codicon-repo"></i></div>
                  <div class="breakdown-content">
                    <div class="breakdown-value">\${formatNumber(breakdown.repositories)}</div>
                    <div class="breakdown-label">Repositories</div>
                  </div>
                </div>
              \` : ''}
            </div>
          </div>
        \` : ''}
        <div class="graph-container">
          <div class="graph-header">
            <div class="graph-title"><i class="codicon codicon-calendar"></i> Contribution Calendar</div>
            <div class="year-selector">
              <select id="yearSelect" class="year-select" onchange="changeYear(this.value)">
                \${yearOptions}
              </select>
              <span class="total-contributions">
                <i class="codicon codicon-graph"></i>
                \${formatNumber(total)} contributions
              </span>
            </div>
          </div>
          <div class="svg-wrapper" id="svgWrapper"></div>
          <div class="legend">
            <span class="legend-label">Less</span>
            <div class="legend-item">
              <span class="legend-square" style="background: #161b22;"></span>
              <span class="legend-square" style="background: #c6e48b;"></span>
              <span class="legend-square" style="background: #7bc96f;"></span>
              <span class="legend-square" style="background: #239a3b;"></span>
              <span class="legend-square" style="background: #196127;"></span>
            </div>
            <span class="legend-label">More</span>
          </div>
        </div>
        <div class="section">
          <div class="section-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="codicon codicon-bell"></i>
              Notifications
              <span id="notificationCount" class="notification-badge" style="display: none;">0</span>
            </div>
            <button class="icon-btn btn-small" title="Refresh notifications" onclick="fetchNotifications(currentContributionsUsername)">
              <i class="codicon codicon-refresh"></i>
            </button>
          </div>
          <div id="notificationsContainer">
            <div class="loading">
              <div class="loading-spinner"></div>
              <div>Loading notifications...</div>
            </div>
          </div>
        </div>
      \`;

      const svgWrapper = document.getElementById('svgWrapper');
      if (!svgWrapper) return;

      // Parse and insert SVG properly
      try {
        // Create a temporary container to parse the SVG
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = data.svg.trim();
        const svgElement = tempDiv.querySelector('svg');
        
        if (!svgElement) {
          throw new Error('SVG element not found in response');
        }

        // Make SVG maintain its natural size for full year display, allow horizontal scroll
        svgElement.style.display = 'block';
        svgElement.style.minWidth = 'max-content';
        
        // Ensure SVG can expand beyond container width for scrolling
        const svgWidth = svgElement.getAttribute('width');
        const svgHeight = svgElement.getAttribute('height');
        if (svgWidth && !isNaN(parseInt(svgWidth))) {
          svgElement.style.width = svgWidth + 'px';
        }
        if (svgHeight && !isNaN(parseInt(svgHeight))) {
          svgElement.style.height = svgHeight + 'px';
        }

        // Style text elements to match VS Code theme
        const texts = svgElement.querySelectorAll('text');
        texts.forEach(text => {
          text.setAttribute('fill', 'var(--vscode-foreground)');
        });

        // Insert the SVG into the wrapper
        svgWrapper.appendChild(svgElement);

        // Apply theme-aware styling and tooltips to contribution squares
        setTimeout(() => {
          // Fetch notifications after graph is successfully rendered
          try {
            const username = data?.username || currentContributionsUsername || (currentAccount?.username);
            if (username) {
              fetchNotifications(username);
            }
          } catch (err) {
            console.error('Error fetching notifications:', err);
          }
          
          const rects = svgElement.querySelectorAll('rect');
          
          rects.forEach(rect => {
            const fillAttr = rect.getAttribute('fill');
            const level = rect.getAttribute('data-level');
            const date = rect.getAttribute('data-date');
            const count = parseInt(rect.getAttribute('data-count') || '0', 10);
            
            // Apply colors based on level - ensure we use the correct color
            const levelNum = level !== null ? parseInt(level, 10) : 0;
            const colors = ['#161b22', '#c6e48b', '#7bc96f', '#239a3b', '#196127'];
            
            if (levelNum === 0) {
              // No contributions
              rect.setAttribute('fill', colors[0]);
              rect.setAttribute('stroke', '#30363d');
              rect.setAttribute('stroke-width', '1');
            } else if (levelNum >= 1 && levelNum <= 4) {
              // Has contributions - use the appropriate green shade
              rect.setAttribute('fill', colors[levelNum]);
              rect.removeAttribute('stroke');
              rect.removeAttribute('stroke-width');
            } else {
              // Fallback
              rect.setAttribute('fill', colors[0]);
            }
            
            // Ensure the level attribute is set for reference
            if (!rect.getAttribute('data-level')) {
              rect.setAttribute('data-level', levelNum.toString());
            }

            // Add tooltip on hover
            if (date && count >= 0) {
              const dateObj = new Date(date + 'T00:00:00');
              const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
              
              rect.addEventListener('mouseenter', (e) => {
                const text = count === 0 
                  ? \`\${dateStr}<br>No contributions\`
                  : \`\${count} contribution\${count !== 1 ? 's' : ''}<br>\${dateStr}\`;
                showTooltip(text, e);
              });

              rect.addEventListener('mouseleave', () => {
                hideTooltip();
              });
            }
          });

          // Ensure SVG background is transparent
          svgElement.style.backgroundColor = 'transparent';
        }, 50);
      } catch (parseError) {
        svgWrapper.innerHTML = '<div class="error"><div class="error-title"><i class="codicon codicon-error"></i>Failed to render contribution graph</div></div>';
      }
    }

    // Initial load - fetch contributions for active account
    setTimeout(() => {
      updateContributionsForAccount(currentAccount);
    }, 100);
  </script>
</body>
</html>`;
  }
}

