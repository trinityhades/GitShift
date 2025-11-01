import * as vscode from 'vscode';
import { exec } from 'child_process';
import { loadAccounts } from './accountManager';
import { getCurrentGitUser } from './gitManager';
import { getGitHubUser, getAllStoredTokens } from './githubAuth';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  owner: { login: string };
}

async function fetchUserRepos(accessToken: string, page: number = 1, perPage: number = 100): Promise<GitHubRepo[]> {
  const response = await fetch(`https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'VSCode-GitShift'
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub API error (${response.status}): ${response.statusText} ${text}`);
  }
  return await response.json() as GitHubRepo[];
}

async function getAllAvailableAccounts(context: vscode.ExtensionContext): Promise<Array<{ username: string; token: string; email?: string; name?: string }>> {
  // Use a Map to ensure no duplicates (keyed by username lowercase)
  const accountsMap = new Map<string, { username: string; token: string; email?: string; name?: string }>();

  // Try to load accounts from workspace
  let accounts: any[] = [];
  try {
    accounts = await loadAccounts();
    // Get tokens for workspace accounts
    for (const acc of accounts) {
      if (!acc.username) continue;
      const token = await context.secrets.get(`github-token-${acc.username}`);
      if (token) {
        const key = acc.username.toLowerCase();
        // Prefer workspace account info (has email/name) over global registry
        if (!accountsMap.has(key)) {
          accountsMap.set(key, {
            username: acc.username,
            token,
            email: acc.email,
            name: acc.name
          });
        } else {
          // Update existing entry with email/name if not already present
          const existing = accountsMap.get(key)!;
          if (!existing.email && acc.email) {
            existing.email = acc.email;
          }
          if (!existing.name && acc.name) {
            existing.name = acc.name;
          }
        }
      }
    }
  } catch (error: any) {
    // If no workspace is open, that's okay - we'll use global registry
  }

  // Also check global token registry (may include accounts not in workspace)
  try {
    const storedTokens = await getAllStoredTokens();
    for (const stored of storedTokens) {
      const key = stored.username.toLowerCase();
      // Only add if not already present (workspace accounts take priority)
      if (!accountsMap.has(key)) {
        accountsMap.set(key, {
          username: stored.username,
          token: stored.token
        });
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return Array.from(accountsMap.values());
}

async function resolveActiveAccountToken(context: vscode.ExtensionContext, allowSelection: boolean = false): Promise<{ username: string; token: string } | null> {
  const availableAccounts = await getAllAvailableAccounts(context);

  if (availableAccounts.length === 0) {
    return null;
  }

  // If only one account, return it directly
  if (availableAccounts.length === 1) {
    return { username: availableAccounts[0].username, token: availableAccounts[0].token };
  }

  // If multiple accounts and selection is allowed, show picker
  if (allowSelection && availableAccounts.length > 1) {
    // Build quick pick items
    const items = await Promise.all(availableAccounts.map(async (acc) => {
      // Label: Always show username/login
      let label = acc.username;

      // Detail: Show email (or name if no email, or username as fallback)
      let detail = acc.email || acc.name || acc.username;

      // Try to fetch user info for better display
      try {
        const user = await getGitHubUser(acc.token);
        label = user.login || acc.username;
        // Prioritize email, then name, then username
        detail = acc.email || user.name || acc.name || acc.username;
      } catch {
        // Use fallback info we already have
      }

      return {
        label,
        detail,
        username: acc.username,
        token: acc.token
      };
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a GitHub account to clone repositories from',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected) {
      return null; // User cancelled
    }

    return { username: selected.username, token: selected.token };
  }

  // If multiple accounts but selection not allowed, try to find the best match
  // Try to match current git config to an account
  try {
    const currentGitUser = await getCurrentGitUser();
    if (currentGitUser) {
      // Try to match by workspace accounts first
      let accounts: any[] = [];
      try {
        accounts = await loadAccounts();
        const matched = accounts.find(a =>
          a.name === currentGitUser.name &&
          a.email === currentGitUser.email &&
          a.username
        );
        if (matched?.username) {
          const account = availableAccounts.find(a => a.username === matched.username);
          if (account) {
            return { username: account.username, token: account.token };
          }
        }
      } catch {
        // No workspace, continue
      }
    }
  } catch {
    // Can't get git user, continue
  }

  // Return the first available account
  return { username: availableAccounts[0].username, token: availableAccounts[0].token };
}

export async function quickCloneRepository(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Resolve active account and token - allow selection if multiple accounts exist
    const auth = await resolveActiveAccountToken(context, true);
    if (!auth) {
      // vscode.window.showWarningMessage('No authenticated GitHub account found. Please sign in first.');
      return;
    }

    // Fetch current user to display context
    let ghUserLogin = auth.username;
    try {
      const user = await getGitHubUser(auth.token);
      ghUserLogin = user.login || auth.username;
    } catch {
      // Silently fail if user fetch fails
    }

    // Fetch repositories (first page up to 100)
    let repos: GitHubRepo[] = [];
    try {
      repos = await fetchUserRepos(auth.token, 1, 100);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to list repositories: ${e.message}`);
      return;
    }

    if (repos.length === 0) {
      vscode.window.showInformationMessage(`No repositories found for ${ghUserLogin}.`);
      return;
    }

    // Build quick pick items
    const items = repos.map(r => ({
      label: r.full_name,
      description: r.description || '',
      detail: `${r.private
        ? '$(lock) Private' // codicon for private
        : '$(globe) Public'}   $(star) ${r.stargazers_count}   $(repo-forked) ${r.forks_count}`,
      repo: r
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select a repository to clone (signed in as ${ghUserLogin})`,
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!selected) return;

    // Choose destination folder
    const dest = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Clone Here'
    });
    if (!dest || dest.length === 0) return;

    // Clone repository securely without exposing token in logs
    const httpsUrl = selected.repo.clone_url; // e.g., https://github.com/owner/repo.git
    const tokenizedUrl = httpsUrl.replace('https://', `https://${encodeURIComponent(auth.token)}@`);

    const repoName = selected.repo.name;
    const repoOwner = selected.repo.owner.login;

    // Show user-friendly message without exposing token
    const cloneMessage = vscode.window.setStatusBarMessage(`Cloning repository ${repoOwner}/${repoName}...`, 1000);

    try {
      // Use git clone directly with controlled output to avoid logging the token
      const cloneDir = dest[0].fsPath;

      // Clone using git command directly with output suppressed to prevent token exposure
      await new Promise<void>((resolve, reject) => {
        const childProcess = exec(
          `git clone "${tokenizedUrl}" "${repoName}"`,
          {
            cwd: cloneDir,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GIT_ASKPASS: 'echo'
            }
          },
          (error, _stdout, _stderr) => {
            if (error) {
              // Sanitize error to remove any token exposure
              const sanitizedError = new Error(error.message?.replace(/https:\/\/[^@]+@github\.com/g, 'https://github.com') || 'Clone failed');
              reject(sanitizedError);
            } else {
              resolve();
            }
          }
        );

        // Explicitly suppress all output to prevent token exposure in logs
        // Redirect stdout/stderr to /dev/null (or NUL on Windows) to completely hide output
        if (childProcess.stdout) {
          childProcess.stdout.on('data', () => { }); // Silently consume output
        }
        if (childProcess.stderr) {
          childProcess.stderr.on('data', () => { }); // Silently consume errors
        }
      });

      cloneMessage.dispose();

      // Show popup dialog with options
      const clonedPath = vscode.Uri.file(`${cloneDir}/${repoName}`);
      const action = await vscode.window.showQuickPick(
        [
          {
            label: '$(folder-opened) Open',
            description: 'Open the cloned repository',
            value: 'open'
          },
          {
            label: '$(window) Open in New Window',
            description: 'Open the cloned repository in a new window',
            value: 'newWindow'
          },
          {
            label: '$(add) Add to Workspace',
            description: 'Add the cloned repository to the current workspace',
            value: 'addToWorkspace'
          }
        ],
        {
          placeHolder: `Successfully cloned ${repoOwner}/${repoName}. What would you like to do?`,
          ignoreFocusOut: false
        }
      );

      if (!action) {
        return; // User cancelled
      }

      if (action.value === 'open') {
        await vscode.commands.executeCommand('vscode.openFolder', clonedPath, false);
      } else if (action.value === 'newWindow') {
        await vscode.commands.executeCommand('vscode.openFolder', clonedPath, true);
      } else if (action.value === 'addToWorkspace') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          // Add to existing workspace
          const workspace = vscode.workspace.getWorkspaceFolder(clonedPath);
          if (!workspace) {
            vscode.workspace.updateWorkspaceFolders(
              workspaceFolders.length,
              null,
              { uri: clonedPath }
            );
          }
        } else {
          // Open as workspace if no workspace exists
          await vscode.commands.executeCommand('vscode.openFolder', clonedPath, false);
        }
      }
    } catch (e: any) {
      if (typeof cloneMessage !== 'undefined' && cloneMessage) {
        cloneMessage.dispose();
      }
      // Sanitize error message to remove any token exposure
      let errorMsg = e.message || 'Failed to clone repository';
      // Remove any token patterns from error message
      errorMsg = errorMsg.replace(/https:\/\/[^@]+@github\.com/g, 'https://github.com');
      vscode.window.showErrorMessage(`Failed to clone repository: ${errorMsg}`);
      throw e; // Re-throw to be caught by extension command handler
    }
  } catch (e: any) {
    // Catch any errors from the outer try block (auth, repo fetching, etc.)
    let errorMsg = e.message || 'Failed to clone repository';
    // Sanitize error message
    errorMsg = errorMsg.replace(/https:\/\/[^@]+@github\.com/g, 'https://github.com');
    vscode.window.showErrorMessage(`Failed to clone repository: ${errorMsg}`);
    throw e; // Re-throw to be caught by extension command handler
  }
}


