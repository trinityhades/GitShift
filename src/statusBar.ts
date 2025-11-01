import * as vscode from 'vscode';
import { getCurrentGitUser } from './gitManager';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Creates and initializes the status bar item
 */
export function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  statusBarItem.command = 'gitshift.switchAccount';
  statusBarItem.tooltip = 'Click to switch GitHub account';

  context.subscriptions.push(statusBarItem);

  return statusBarItem;
}

/**
 * Updates the status bar with the current git user
 */
export async function updateStatusBar(): Promise<void> {
  if (!statusBarItem) {
    return;
  }

  const gitUser = await getCurrentGitUser();

  if (gitUser) {
    // Extract just the name without email domain for cleaner display
    const displayName = gitUser.name;
    statusBarItem.text = `$(account) ${displayName}`;
    statusBarItem.show();
  } else {
    statusBarItem.text = `$(account) No Git Identity`;
    statusBarItem.tooltip = 'No git user configured. Click to set up.';
    statusBarItem.show();
  }
}

/**
 * Hides the status bar item
 */
export function hideStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.hide();
  }
}

/**
 * Shows the status bar item
 */
export function showStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.show();
  }
}

/**
 * Gets the status bar item
 */
export function getStatusBarItem(): vscode.StatusBarItem | undefined {
  return statusBarItem;
}

