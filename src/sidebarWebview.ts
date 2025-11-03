/**
 * GitShift - Sidebar Webview Provider
 * Copyright (c) 2025 mikeeeyy04
 * https://github.com/mikeeeyy04/GitShift
 * 
 * MIT License - See LICENSE file for details
 */

import * as vscode from 'vscode';
import { GitHubAccount } from './types';
import { loadAccounts, saveAccounts, accountsFileExists } from './accountManager';
import { getCurrentGitUser, isGitRepository } from './gitManager';
// getGitHubToken import removed - not currently used

/**
 * Provides the webview content for the sidebar
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _isVisible: boolean = false;
  private _outputChannel?: vscode.OutputChannel;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._outputChannel = vscode.window.createOutputChannel('GitShift Sidebar');
  }

  private _log(message: string, type: 'info' | 'error' | 'warn' = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? 'ERROR' : type === 'warn' ? 'WARN' : 'INFO';
    const logMessage = `[${timestamp}] [${prefix}] ${message}`;

    if (this._outputChannel) {
      this._outputChannel.appendLine(logMessage);
      if (type === 'error') {
        this._outputChannel.show(true);
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    // Track visibility
    this._isVisible = webviewView.visible;
    webviewView.onDidChangeVisibility(() => {
      this._isVisible = webviewView.visible;
      if (this._isVisible) {
        this.refresh();
      }
    });

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      this._log(`Received message: ${JSON.stringify(data)}`);
      try {
        switch (data.type) {
          case 'switchAccount':
            this._log('Switching account...');
            await vscode.commands.executeCommand('gitshift.switchToAccount', data.account);
            // Account state is updated smoothly via updateAccountState() in extension.ts
            break;
          case 'deleteAccount':
            this._log(`Deleting account: ${data.email}`);
            await this._deleteAccount(data.email);
            break;
          case 'addToken':
            this._log('Adding token...');
            await vscode.commands.executeCommand('gitshift.addToken');
            this.refresh();
            break;
          case 'replaceToken':
            this._log('Replacing token...');
            await vscode.commands.executeCommand('gitshift.addToken');
            this.refresh();
            break;
          case 'removeToken':
            this._log(`Removing token: ${data.username || 'default'}`);
            if (data.username) {
              await vscode.commands.executeCommand('gitshift.removeToken', data.username);
            } else {
              await vscode.commands.executeCommand('gitshift.removeToken');
            }
            this.refresh();
            break;
          case 'signIn':
            this._log('Signing in with GitHub...');
            await vscode.commands.executeCommand('gitshift.signInWithGitHub');
            this.refresh();
            break;
          case 'import':
            this._log('Importing accounts...');
            // Show importing state
            this.postMessage({ type: 'setImporting', importing: true });
            try {
              await vscode.commands.executeCommand('gitshift.importAccounts');
              this.refresh();
            } catch (error) {
              // Hide importing state on error
              this.postMessage({ type: 'setImporting', importing: false });
              throw error;
            }
            break;
          case 'quickClone':
            this._log('Quick cloning repository...');
            await vscode.commands.executeCommand('gitshift.quickCloneRepo');
            this.refresh();
            break;
          case 'initializeRepository':
            this._log('Initializing repository...');
            try {
              // Check if command exists
              const commands = await vscode.commands.getCommands();
              const commandExists = commands.includes('gitshift.initRepo');
              this._log(`Command exists: ${commandExists}`);

              if (!commandExists) {
                this._log('Command gitshift.initRepo not found!', 'error');
                vscode.window.showErrorMessage('Initialize Repository command not found. Please reload the extension.');
                return;
              }

              this._log('Executing command: gitshift.initRepo');
              const result = await vscode.commands.executeCommand('gitshift.initRepo');
              this._log(`Command execution result: ${result}`);
              this._log('Repository initialized successfully');
              this.refresh();
            } catch (error: any) {
              this._log(`Failed to initialize repository: ${error.message || 'Unknown error'}`, 'error');
              this._log(`Error stack: ${error.stack || 'No stack trace'}`, 'error');
              vscode.window.showErrorMessage(`Failed to initialize repository: ${error.message || 'Unknown error'}`);
            }
            break;
          case 'publishToGitHub':
            this._log('Publishing to GitHub...');
            try {
              this._log('Executing command: gitshift.publishToGitHub');
              await vscode.commands.executeCommand('gitshift.publishToGitHub');
              this._log('Published to GitHub successfully');
              this.refresh();
            } catch (error: any) {
              this._log(`Failed to publish to GitHub: ${error.message || 'Unknown error'}`, 'error');
              this._log(`Error stack: ${error.stack || 'No stack trace'}`, 'error');
              vscode.window.showErrorMessage(`Failed to publish to GitHub: ${error.message || 'Unknown error'}`);
            }
            break;
          case 'reorderAccounts':
            await this._reorderAccounts(data.fromIndex, data.toIndex);
            break;
          case 'openActions': {
            // Open quick actions for a specific account
            const accounts = await loadAccounts();
            const acc = accounts.find(a => a.email === data.email);
            if (!acc) { return; }

            const picks: Array<{ label: string; action: string }> = [
              { label: 'Switch to this account', action: 'switch' },
              { label: 'Add/Replace Token', action: 'addToken' }
            ];
            if (acc.username && acc.authenticated) {
              picks.push({ label: 'Remove Token', action: 'removeToken' });
            }
            picks.push({ label: 'Delete Account', action: 'delete' });

            const choice = await vscode.window.showQuickPick(picks, { placeHolder: acc.label || acc.name });
            if (!choice) { return; }

            if (choice.action === 'switch') {
              await vscode.commands.executeCommand('gitshift.switchToAccount', acc);
              // Account state is updated smoothly via updateAccountState() in extension.ts
            } else if (choice.action === 'addToken') {
              await this._showTokenTutorial(acc);
              this.refresh();
            } else if (choice.action === 'removeToken') {
              if (acc.username) {
                await vscode.commands.executeCommand('gitshift.removeToken', acc.username);
                this.refresh();
              }
            } else if (choice.action === 'delete') {
              await this._deleteAccount(acc.email);
            }
            break;
          }
        }
      } catch (error: any) {
        this._log(`Unhandled error in message handler: ${error.message || 'An error occurred'}`, 'error');
        this._log(`Error stack: ${error.stack || 'No stack trace'}`, 'error');
        vscode.window.showErrorMessage(`GitShift: ${error.message || 'An error occurred'}`);
      }
    });
  }

  public async refresh(force: boolean = false) {
    if (this._view && (this._isVisible || force)) {
      // Load content directly without showing loading screen
      const html = await this._getHtmlContent();
      this._view.webview.html = html;
    }
  }

  public postMessage(message: any) {
    if (this._view && this._isVisible) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Update account state smoothly without full refresh
   */
  public async updateAccountState(currentUser: { name: string; email: string } | null, currentAccount: any) {
    if (this._view && this._isVisible) {
      this.postMessage({
        type: 'updateAccountState',
        currentUser,
        currentAccount
      });
    }
  }

  private async _deleteAccount(email: string) {
    try {
      const accounts = await loadAccounts();
      const account = accounts.find((acc) => acc.email === email);

      const filtered = accounts.filter((acc) => acc.email !== email);
      await saveAccounts(filtered);

      // Trigger deletion command to clean up stored token
      if (account && account.username) {
        await vscode.commands.executeCommand('gitshift.deleteAccountToken', account.username);
      }

      this.refresh();
      vscode.window.showInformationMessage('Account deleted');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete account: ${error.message}`);
    }
  }

  private async _showTokenTutorial(account?: any) {
    // Create and show a webview panel with token tutorial
    const panel = vscode.window.createWebviewPanel(
      'tokenTutorial',
      'GitHub Token Tutorial',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: false
      }
    );

    const tutorialHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitHub Token Tutorial</title>
    <style>
        @import url('https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css');
        .codicon {
            font-family: var(--vscode-icon-font-family);
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 24px;
            line-height: 1.6;
        }
        .header {
            margin-bottom: 24px;
        }
        .header h1 {
            font-size: 24px;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .step {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
        }
        .step-number {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 50%;
            font-weight: 600;
            font-size: 14px;
            margin-right: 12px;
            vertical-align: middle;
        }
        .step-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
            display: inline-block;
        }
        .step-content {
            margin-left: 40px;
            margin-top: 8px;
        }
        .step-content ol {
            margin-left: 20px;
            margin-top: 8px;
        }
        .step-content li {
            margin-bottom: 8px;
            color: var(--vscode-descriptionForeground);
        }
        .step-content strong {
            color: var(--vscode-foreground);
        }
        .important-note {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            border-radius: 6px;
            padding: 16px;
            margin: 20px 0;
        }
        .important-note-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-notificationsWarningIcon-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .scope-list {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            margin-top: 12px;
        }
        .scope-item {
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .scope-item:last-child {
            border-bottom: none;
        }
        .scope-name {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .scope-desc {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .button-group {
            display: flex;
            gap: 12px;
            margin-top: 24px;
            justify-content: flex-end;
        }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: transparent;
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .link {
            color: var(--vscode-textLink-foreground);
            text-decoration: underline;
            cursor: pointer;
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1><i class="codicon codicon-key"></i> GitHub Personal Access Token</h1>
        <p>Follow these steps to create and add your GitHub Personal Access Token</p>
    </div>

    <div class="step">
        <span class="step-number">1</span>
        <span class="step-title">Go to GitHub Token Settings</span>
        <div class="step-content">
            <p>Open the GitHub Personal Access Tokens page:</p>
            <p>
                <button class="btn btn-primary" onclick="vscode.postMessage({command: 'openTokenPage'})" style="margin-top: 8px;">
                    <i class="codicon codicon-link-external" style="margin-right: 4px; font-size: 14px; vertical-align: text-bottom;"></i>Open GitHub Token Page
                </button>
            </p>
            <p style="margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground);">
                Or manually: GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)
            </p>
        </div>
    </div>

    <div class="step">
        <span class="step-number">2</span>
        <span class="step-title">Generate New Token</span>
        <div class="step-content">
            <ol>
                <li>Click <strong>"Generate new token"</strong> → <strong>"Generate new token (classic)"</strong></li>
                <li>Give your token a descriptive name (e.g., "GitShift for VS Code")</li>
                <li>Set an expiration date (or "No expiration" for long-term use)</li>
            </ol>
        </div>
    </div>

    <div class="step">
        <span class="step-number">3</span>
        <span class="step-title">Select Required Scopes</span>
        <div class="step-content">
            <p>Enable the following scopes (checkboxes):</p>
            <div class="scope-list">
                <div class="scope-item">
                    <div class="scope-name">
                        <i class="codicon codicon-package" style="margin-right:4px; vertical-align:middle;"></i>
                        repo
                    </div>
                    <div class="scope-desc">Full control of private repositories (required for Git operations)</div>
                </div>
                <div class="scope-item">
                    <div class="scope-name">
                        <i class="codicon codicon-mail" style="margin-right:4px; vertical-align:middle;"></i>
                        user:email
                    </div>
                    <div class="scope-desc">Access user email addresses (required to get your actual email, not no-reply GitHub email)</div>
                </div>
                <div class="scope-item">
                    <div class="scope-name">
                        <i class="codicon codicon-account" style="margin-right:4px; vertical-align:middle;"></i>
                        read:user
                    </div>
                    <div class="scope-desc">Read user profile data (required to see all contributions, including public repos)</div>
                </div>
                <div class="scope-item">
                    <div class="scope-name">
                        <i class="codicon codicon-sync" style="margin-right:4px; vertical-align:middle;"></i>
                        workflow
                    </div>
                    <div class="scope-desc">Update GitHub Action workflows (required for workflow management)</div>
                </div>
                <div class="scope-item">
                    <div class="scope-name">
                        <i class="codicon codicon-bell" style="margin-right:4px; vertical-align:middle;"></i>
                        notifications
                    </div>
                    <div class="scope-desc">Access notifications (required for viewing GitHub notifications in the extension)</div>
                </div>
            </div>
            <p style="margin-top: 12px;"><strong>Important:</strong> 
            <ul style="margin-top: 8px; margin-left: 20px;">
                <li>Without <code>read:user</code> scope, you'll only see contributions from private repositories.</li>
                <li>Without <code>user:email</code> scope, we may use your no-reply GitHub email instead of your actual email.</li>
                <li>Without <code>notifications</code> scope, you won't be able to view GitHub notifications.</li>
            </ul>
            </p>
            <p style="margin-top: 12px; padding: 8px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground);">
                <strong><i class="codicon codicon-lightbulb" style="margin-right:4px;"></i>Tip:</strong> If you prefer, you can use <strong>"Sign In with GitHub"</strong> instead, which automatically includes all required scopes (repo, user:email, read:user, workflow, notifications)!
            </p>
        </div>
    </div>

    <div class="step">
        <span class="step-number">4</span>
        <span class="step-title">Generate and Copy Token</span>
        <div class="step-content">
            <ol>
                <li>Scroll down and click <strong>"Generate token"</strong></li>
                <li><strong>IMPORTANT:</strong> Copy the token immediately - you won't be able to see it again!</li>
                <li>The token will look like: <code>ghp_EXAMPLE_TOKEN_HERE</code></li>
            </ol>
        </div>
    </div>

    <div class="important-note">
        <div class="important-note-title">
            <i class="codicon codicon-warning" style="margin-right:4px;"></i>Security Reminder
        </div>
        <p>Never share your token publicly or commit it to version control. Treat it like a password!</p>
    </div>

    <div class="button-group">
        <button class="btn btn-secondary" onclick="vscode.postMessage({command: 'cancel'})">Cancel</button>
        <button class="btn btn-primary" onclick="vscode.postMessage({command: 'proceed'})">I've Created My Token - Continue</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
    </script>
</body>
</html>`;

    panel.webview.html = tutorialHtml;

    // Handle messages from the tutorial panel
    return new Promise<void>((resolve) => {
      const disposables: vscode.Disposable[] = [];

      disposables.push(
        panel.webview.onDidReceiveMessage(async (message) => {
          if (message.command === 'openTokenPage') {
            // Open GitHub token creation page with pre-filled parameters
            const tokenUrl = 'https://github.com/settings/tokens/new?scopes=repo,user:email,read:user,workflow,notifications&description=GitShift+for+VS+Code';
            await vscode.env.openExternal(vscode.Uri.parse(tokenUrl));
          } else if (message.command === 'proceed') {
            // Close tutorial and proceed to token input
            panel.dispose();
            disposables.forEach(d => d.dispose());
            await vscode.commands.executeCommand('gitshift.addToken', account);
            resolve();
          } else if (message.command === 'cancel') {
            panel.dispose();
            disposables.forEach(d => d.dispose());
            resolve();
          }
        })
      );

      disposables.push(
        panel.onDidDispose(() => {
          disposables.forEach(d => d.dispose());
          resolve();
        })
      );
    });
  }

  private async _reorderAccounts(fromIndex: number, toIndex: number) {
    try {
      const accounts = await loadAccounts();

      // Remove the item from the original position
      const [movedAccount] = accounts.splice(fromIndex, 1);

      // Insert it at the new position
      accounts.splice(toIndex, 0, movedAccount);

      // Save the reordered accounts
      await saveAccounts(accounts);

      // Refresh the UI
      this.refresh();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to reorder accounts: ${error.message}`);
    }
  }

  private _getHtmlForWebview(_webview: vscode.Webview) {
    // This will be populated asynchronously
    this._getHtmlContent().then(html => {
      if (this._view) {
        this._view.webview.html = html;
      }
    });

    // Return loading state immediately
    return this._getLoadingHtml();
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--vscode-sideBar-background);
      color: #e6e6e6;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      justify-items: center;
      min-height: 200px;
    }
  </style>
</head>
<body>
  <div>Loading GitShift...</div>
</body>
</html>`;
  }

  private async _getHtmlContent(): Promise<string> {
    let accounts: GitHubAccount[] = [];
    let currentUser: { name: string; email: string } | null = null;
    let currentAccount: GitHubAccount | null = null;
    let isGitRepo = false;
    try {
      isGitRepo = await isGitRepository();
      await accountsFileExists(); // Check if config exists but don't store result
      accounts = await loadAccounts();
      currentUser = await getCurrentGitUser();

      // Auto-activate first account if no repo and no current user
      if (!isGitRepo && !currentUser && accounts.length > 0) {
        this._log(`No Git repository and no current user. Auto-activating first account: ${accounts[0].label || accounts[0].name}`);
        try {
          // Switch to the first account
          await vscode.commands.executeCommand('gitshift.switchToAccount', accounts[0]);
          // Update currentUser after switching
          currentUser = await getCurrentGitUser();
        } catch (error: any) {
          this._log(`Failed to auto-activate first account: ${error.message}`, 'warn');
          // Continue anyway - user can manually switch
        }
      }

      // Find the current account from accounts list to get avatar
      if (currentUser) {
        currentAccount = accounts.find(acc =>
          acc.name === currentUser!.name && acc.email === currentUser!.email
        ) || null;
      }
    } catch (error) {
      console.error('Error loading data for sidebar:', error);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css" rel="stylesheet" />
  <title>GitHub Accounts</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    .cursor-pointer {
      cursor: pointer;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: transparent;
      color: var(--vscode-foreground);
      padding: clamp(8px, 2.5vw, 16px);
      font-size: clamp(12px, 3vw, 13px);
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      height: 100vh;
    }

    .section {
      margin-bottom: clamp(16px, 4vw, 24px);
    }

    .section-title {
      font-size: clamp(10px, 2.5vw, 11px);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: clamp(10px, 2.5vw, 14px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .btn {
      padding: clamp(6px, 1.5vw, 8px) clamp(10px, 2.5vw, 14px);
      border: 1px solid var(--vscode-button-border);
      border-radius: 4px;
      font-size: clamp(11px, 2.8vw, 13px);
      font-weight: 400;
      cursor: pointer;
      transition: all 0.15s ease;
      background: transparent;
      color: var(--vscode-button-foreground);
      width: 100%;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-primary {
      background: var(--vscode-button-background);
      border: none;
      border-radius: 4px;
    }

    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn i.codicon {
      margin-right: 6px;
      font-size: inherit;
      vertical-align: middle;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      pointer-events: none;
    }

    .btn-loader {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-button-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .btn-small {
      padding: clamp(4px, 1vw, 6px) clamp(8px, 2vw, 12px);
      font-size: clamp(10px, 2.5vw, 11px);
      width: auto;
    }

    .current-account {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: clamp(10px, 2.5vw, 14px);
      margin-bottom: clamp(12px, 3vw, 18px);
      transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .current-account.updating {
      opacity: 0.6;
      transform: scale(0.98);
    }

    .current-label {
      font-size: clamp(9px, 2.2vw, 10px);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: clamp(6px, 1.5vw, 10px);
    }

    .account-info {
      display: flex;
      align-items: center;
      gap: clamp(8px, 2vw, 12px);
    }

    .account-avatar {
      width: clamp(28px, 7vw, 36px);
      height: clamp(28px, 7vw, 36px);
      border-radius: 4px;
      background: var(--vscode-textBlockQuote-background);
      border: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: clamp(12px, 3.2vw, 14px);
      font-weight: 500;
      flex-shrink: 0;
      overflow: hidden;
    }

    .account-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .account-details {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .account-details h4 {
      font-size: clamp(12px, 3vw, 13px);
      font-weight: 500;
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .account-details p {
      font-size: clamp(10px, 2.5vw, 11px);
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .account-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: clamp(8px, 2vw, 12px);
      margin-bottom: clamp(6px, 1.5vw, 10px);
      cursor: pointer;
      transition: all 0.15s ease;
      position: relative;
    }

    .account-card.dragging {
      opacity: 0.5;
    }

    .account-card.drag-over {
      border-top: 2px solid var(--vscode-focusBorder);
    }

    .account-card:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    .account-card.active {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
      cursor: default;
    }

    .account-card.active:hover {
      cursor: default;
    }

    .account-card.loading {
      position: relative;
      pointer-events: none;
      overflow: hidden;
    }

    /* Skeleton loading animation - shimmer effect moving left to right */
    .account-card.loading::after {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.2) 50%,
        transparent 100%
      );
      animation: shimmer 1.5s ease-in-out infinite;
      pointer-events: none;
      z-index: 1;
    }

    @keyframes shimmer {
      0% {
        left: -100%;
      }
      100% {
        left: 100%;
      }
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: clamp(6px, 1.5vw, 8px);
    }

    .drag-handle {
      width: clamp(10px, 2vw, 14px);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: var(--vscode-descriptionForeground);
      opacity: 0.5;
      transition: opacity 0.15s ease;
      flex-shrink: 0;
      font-size: clamp(12px, 3vw, 14px);
      letter-spacing: -2px;
      user-select: none;
    }

    .drag-handle:hover {
      opacity: 1;
    }

    .drag-handle:active {
      cursor: grabbing;
    }

    .card-content {
      display: flex;
      align-items: center;
      gap: clamp(6px, 1.5vw, 10px);
      flex: 1;
      min-width: 0;
    }

    .card-avatar {
      width: clamp(24px, 6vw, 30px);
      height: clamp(24px, 6vw, 30px);
      border-radius: 4px;
      background: var(--vscode-textBlockQuote-background);
      border: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: clamp(11px, 2.8vw, 13px);
      font-weight: 500;
      flex-shrink: 0;
      overflow: hidden;
    }

    .card-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .card-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .card-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 2px;
    }

    .card-info h5 {
      font-size: clamp(11px, 2.8vw, 12px);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
      margin: 0;
    }

    .card-info p {
      font-size: clamp(10px, 2.5vw, 11px);
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .card-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-shrink: 0;
    }

    .badge {
      height: 14px;
      padding: 0 4px;
      border-radius: 2px;
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    /* Authentication icons - check/X next to name */
    .auth-icon {
      font-size: clamp(12px, 3vw, 14px) !important;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .auth-icon-valid {
      color: var(--vscode-gitDecoration-addedResourceForeground);
    }
    .auth-icon-invalid {
      color: var(--vscode-inputValidation-errorForeground);
    }

    /* Active badge - matches icon-btn style */
    .active-badge {
      height: 24px;
      padding: 0 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: clamp(10px, 2.5vw, 11px);
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      flex-shrink: 0;
      text-transform: uppercase;
      transition: opacity 0.3s ease, transform 0.3s ease;
      animation: fadeIn 0.3s ease;
    }

    /* PAT token badge - same style as active badge but with key icon */
    .pat-badge {
      height: 24px;
      padding: 0 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: clamp(12px, 3vw, 14px);
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      flex-shrink: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      gap: 4px;
    }

    .pat-badge .codicon {
      font-size: clamp(12px, 3vw, 14px);
      line-height: 1;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: scale(0.9);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .icon-btn {
      width: 24px;
      height: 24px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .icon-btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
    }

    .empty-state {
      text-align: center;
      padding: clamp(20px, 5vw, 32px) clamp(10px, 2.5vw, 16px);
      color: var(--vscode-descriptionForeground);
    }

    .empty-state h3 {
      font-size: clamp(12px, 3vw, 14px);
      font-weight: 500;
      margin-bottom: clamp(6px, 1.5vw, 10px);
    }

    .empty-state p {
      font-size: clamp(10px, 2.5vw, 11px);
      margin-bottom: clamp(10px, 2.5vw, 14px);
      line-height: 1.5;
    }


    .no-repo-container {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: clamp(20px, 5vw, 32px);
      margin-bottom: clamp(12px, 3vw, 18px);
      text-align: center;
    }

    .no-repo-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .warning-box {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-left: 2px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: clamp(8px, 2vw, 12px);
      margin-bottom: clamp(12px, 3vw, 18px);
      font-size: clamp(10px, 2.5vw, 11px);
    }

    .warning-box h4 {
      font-size: clamp(11px, 2.8vw, 12px);
      font-weight: 500;
      margin-bottom: clamp(3px, 0.8vw, 5px);
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: clamp(6px, 1.5vw, 10px);
      margin-top: clamp(12px, 3vw, 16px);
    }

    /* Responsive adjustments for very narrow sidebars */
    @media (max-width: 220px) {
      .section-title {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }

      .btn-small {
        width: 100%;
      }

      .card-header {
        flex-wrap: wrap;
      }

      .badge {
        font-size: 7px;
        padding: 2px 4px;
      }
    }

    /* Custom Minimalist Scrollbar */
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

  </style>
</head>
<body>
  ${!isGitRepo ? `
    <div class="no-repo-container">
      <div class="no-repo-content">
        <i class="codicon codicon-repo" style="font-size: 32px; opacity: 0.5; margin-bottom: 12px;"></i>
        <h3 style="font-size: clamp(13px, 3.2vw, 15px); font-weight: 600; margin-bottom: 8px;">Not in a Git repository</h3>
        <p style="font-size: clamp(11px, 2.8vw, 12px); color: var(--vscode-descriptionForeground); margin-bottom: 16px; line-height: 1.5;">
          Initialize a repository to enable source control features powered by Git.
        </p>
        <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
          <button class="btn btn-primary cursor-pointer" onclick="initializeRepository()" title="Initialize a Git repository in this folder">
            <i class="codicon codicon-repo"></i> Initialize Repository
          </button>
          <button class="btn btn-primary cursor-pointer" onclick="publishToGitHub()" title="Publish this folder to a GitHub repository">
            <i class="codicon codicon-github" style="font-size: 14px;"></i> Publish to GitHub
          </button>
          <button class="btn btn-primary cursor-pointer" onclick="quickClone()" title="Clone a GitHub repository">
            <i class="codicon codicon-repo-clone"></i> Quick Clone Repository
          </button>
        </div>
      </div>
    </div>
  ` : ''}

  ${isGitRepo && currentUser ? `
    <div class="current-account">
      <div class="current-label">Current Identity</div>
      <div class="account-info">
        <div class="account-avatar">
          ${currentAccount?.avatarUrl
          ? `<img src="${currentAccount.avatarUrl}" alt="${currentUser.name}" />`
          : currentUser.name.charAt(0).toUpperCase()
        }
        </div>
        <div class="account-details">
          <h4>${currentUser.name}</h4>
          <p>${currentUser.email}</p>
        </div>
      </div>
    </div>
  ` : ''}

  <div class="section">
    <div class="section-title">
      <span>Accounts</span>
      ${accounts.length > 0 ? '<button class="btn-small btn-primary cursor-pointer" onclick="signIn()">Add Account</button>' : ''}
    </div>

    ${accounts.length === 0 && isGitRepo ? `
      <div class="empty-state">
        <h3>No Accounts</h3>
        <p>Import your current GitHub session from VS Code or sign in with a new account</p>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
          <button id="importBtn" class="btn btn-primary cursor-pointer" onclick="importAccounts()" title="Import current active GitHub session from VS Code">
            <span class="btn-text">Import Active Session</span>
            <span class="btn-loader" style="display: none;">
              <span class="spinner"></span>
              Importing...
            </span>
          </button>
          <button class="btn btn-primary cursor-pointer" onclick="signIn()">Sign In New Account</button>
        </div>
      </div>
    ` : ''}

    ${accounts.map((account, index) => {
          const isActive = currentUser &&
            currentUser.name === account.name &&
            currentUser.email === account.email;

          return `
        <div class="account-card ${isActive ? 'active' : ''}" 
             data-email="${account.email}"
             data-index="${index}"
             ondragover="handleDragOver(event)"
             ondragleave="handleDragLeave(event)"
             ondrop="handleDrop(event)"
             onclick="handleCardClick(event, '${account.email}')">
          <div class="card-header">
            <div class="drag-handle" 
                 draggable="true"
                 ondragstart="handleDragStart(event)"
                 ondragend="handleDragEnd(event)"
                 onclick="event.stopPropagation()">
              ⋮⋮
            </div>
            <div class="card-content">
              <div class="card-avatar">
                ${account.avatarUrl
              ? `<img src="${account.avatarUrl}" alt="${account.name}" />`
              : account.name.charAt(0).toUpperCase()
            }
              </div>
              <div class="card-info">
                <div class="card-name-row">
                  <h5>${account.label}</h5>
                  ${account.authenticated ? '<i class="codicon codicon-check auth-icon auth-icon-valid" title="Authenticated"></i>' : '<i class="codicon codicon-x auth-icon auth-icon-invalid" title="Authentication needed"></i>'}
                </div>
                <p>${account.email}</p>
              </div>
            </div>
            <div class="card-actions">
              ${isActive ? '<span class="active-badge" title="Active">Active</span>' : ''}
              ${account.authenticated && account.username ? '<span class="pat-badge" title="Has Personal Access Token"><i class="codicon codicon-key"></i></span>' : ''}
              <button class="icon-btn" title="More actions" onclick="openActions(event, '${account.email}')">⋯</button>
            </div>
          </div>
        </div>
      `;
        }).join('')}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let draggedElement = null;

    function handleCardClick(event, email) {
      // Only trigger switch if not clicking on buttons
      if (event.target.closest('.icon-btn') || event.target.closest('.badge')) {
        return;
      }
      
      // Check if clicking on already active account
      const clickedCard = event.currentTarget;
      if (clickedCard && clickedCard.classList.contains('active')) {
        return; // Already active, do nothing
      }
      
      switchAccount(email);
    }

    function switchAccount(email) {
      const accounts = ${JSON.stringify(accounts)};
      const account = accounts.find(acc => acc.email === email);
      if (account) {
        vscode.postMessage({ type: 'switchAccount', account });
      }
    }

    function deleteAccount(event, email) {
      event.stopPropagation();
      vscode.postMessage({ type: 'deleteAccount', email });
    }

    function openActions(event, email) {
      event.stopPropagation();
      vscode.postMessage({ type: 'openActions', email });
    }

    function signIn() {
      vscode.postMessage({ type: 'signIn' });
    }

    function importAccounts() {
      vscode.postMessage({ type: 'import' });
    }

    function quickClone() {
      vscode.postMessage({ type: 'quickClone' });
    }

    let isInitializing = false;
    let isPublishing = false;

    function initializeRepository() {
      if (isInitializing) {
        return;
      }
      isInitializing = true;
      // Use setTimeout to ensure the click event is fully processed before sending message
      setTimeout(() => {
        vscode.postMessage({ type: 'initializeRepository' });
        // Reset flag after a delay
        setTimeout(() => {
          isInitializing = false;
        }, 2000);
      }, 100);
    }

    function publishToGitHub() {
      if (isPublishing) {
        return;
      }
      isPublishing = true;
      // Use setTimeout to ensure the click event is fully processed before sending message
      setTimeout(() => {
        vscode.postMessage({ type: 'publishToGitHub' });
        // Reset flag after a delay
        setTimeout(() => {
          isPublishing = false;
        }, 2000);
      }, 100);
    }

    // Drag and drop handlers
    function handleDragStart(event) {
      // Find the parent card element
      const cardElement = event.target.closest('.account-card');
      draggedElement = cardElement;
      cardElement.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', cardElement.innerHTML);
    }

    function handleDragEnd(event) {
      // Find the parent card element
      const cardElement = event.target.closest('.account-card');
      if (cardElement) {
        cardElement.classList.remove('dragging');
      }
      
      // Remove drag-over class from all cards
      document.querySelectorAll('.account-card').forEach(card => {
        card.classList.remove('drag-over');
      });
    }

    function handleDragOver(event) {
      if (event.preventDefault) {
        event.preventDefault();
      }
      event.dataTransfer.dropEffect = 'move';

      const currentCard = event.currentTarget;
      if (currentCard !== draggedElement) {
        currentCard.classList.add('drag-over');
      }
      
      return false;
    }

    function handleDragLeave(event) {
      event.currentTarget.classList.remove('drag-over');
    }

    function handleDrop(event) {
      if (event.stopPropagation) {
        event.stopPropagation();
      }

      const dropTarget = event.currentTarget;
      
      if (draggedElement !== dropTarget) {
        const draggedIndex = parseInt(draggedElement.dataset.index);
        const dropIndex = parseInt(dropTarget.dataset.index);
        
        // Send reorder message to extension
        vscode.postMessage({
          type: 'reorderAccounts',
          fromIndex: draggedIndex,
          toIndex: dropIndex
        });
      }

      return false;
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'setAccountLoading' && message.email) {
        const card = document.querySelector(\`[data-email="\${message.email}"]\`);
        if (card) {
          if (message.loading) {
            card.classList.add('loading');
          } else {
            card.classList.remove('loading');
          }
        }
      } else if (message.type === 'updateAccountState') {
        updateAccountState(message.currentUser, message.currentAccount);
      } else if (message.type === 'setImporting') {
        setImportingState(message.importing);
      }
    });

    // Handle importing state
    function setImportingState(importing) {
      const importBtn = document.getElementById('importBtn');
      if (!importBtn) return;

      const btnText = importBtn.querySelector('.btn-text');
      const btnLoader = importBtn.querySelector('.btn-loader');

      if (importing) {
        importBtn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (btnLoader) btnLoader.style.display = 'flex';
      } else {
        importBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (btnLoader) btnLoader.style.display = 'none';
      }
    }

    // Smoothly update account state without full refresh
    function updateAccountState(currentUser, currentAccount) {
      // Update current account display
      const currentAccountDiv = document.querySelector('.current-account');
      if (currentAccountDiv && currentUser) {
        // Add updating class for smooth transition
        currentAccountDiv.classList.add('updating');
        
        setTimeout(() => {
          const avatar = currentAccountDiv.querySelector('.account-avatar');
          const name = currentAccountDiv.querySelector('.account-details h4');
          const email = currentAccountDiv.querySelector('.account-details p');
          
          if (avatar) {
            if (currentAccount?.avatarUrl) {
              avatar.innerHTML = \`<img src="\${currentAccount.avatarUrl}" alt="\${currentUser.name}" />\`;
            } else {
              avatar.textContent = currentUser.name.charAt(0).toUpperCase();
            }
          }
          
          if (name) name.textContent = currentUser.name;
          if (email) email.textContent = currentUser.email;
          
          // Remove updating class
          currentAccountDiv.classList.remove('updating');
        }, 150);
      }

      // Update active states on all account cards
      document.querySelectorAll('.account-card').forEach(card => {
        const cardEmail = card.getAttribute('data-email');
        const isActive = currentUser && 
          currentUser.email === cardEmail;
        
        const hadActiveBadge = card.querySelector('.active-badge');
        const patBadge = card.querySelector('.pat-badge');
        const cardActions = card.querySelector('.card-actions');
        
        if (isActive) {
          card.classList.add('active');
          // Add active badge if it doesn't exist
          if (!hadActiveBadge && cardActions) {
            const activeBadge = document.createElement('span');
            activeBadge.className = 'active-badge';
            activeBadge.title = 'Active';
            activeBadge.textContent = 'Active';
            // Insert before PAT badge if it exists, otherwise before first child (more actions button)
            const insertBefore = patBadge || cardActions.firstChild;
            cardActions.insertBefore(activeBadge, insertBefore);
          }
        } else {
          card.classList.remove('active');
          // Remove active badge if it exists
          if (hadActiveBadge) {
            hadActiveBadge.remove();
          }
        }
      });
    }

  </script>
</body>
</html>`;
  }
}

