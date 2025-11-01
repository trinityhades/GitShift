import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execPromise = promisify(exec);

/**
 * Gets the workspace root path
 */
function getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    return workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri.fsPath
        : undefined;
}

/**
 * Configures git to use a credential helper with the provided token
 */
export async function configureGitCredentials(_username: string, _token: string): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        throw new Error('No workspace folder is open');
    }

    try {
        // Configure git credential helper to store credentials
        await execPromise('git config --local credential.helper store', {
            cwd: workspaceRoot
        });
    } catch (error: any) {
        throw new Error(`Failed to configure git credentials`);
    }
}

/**
 * Updates the git remote URL to use HTTPS with embedded token
 */
export async function updateRemoteUrlWithToken(remoteName: string, token: string, username: string): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        throw new Error('No workspace folder is open');
    }

    try {
        // Get current remote URL
        const { stdout } = await execPromise(`git remote get-url ${remoteName}`, {
            cwd: workspaceRoot
        });

        const currentUrl = stdout.trim();

        // Parse the URL to extract owner/repo
        let newUrl: string;

        if (currentUrl.startsWith('git@github.com:')) {
            // Convert SSH to HTTPS with token
            const repoPath = currentUrl.replace('git@github.com:', '').replace('.git', '');
            newUrl = `https://${username}:${token}@github.com/${repoPath}.git`;
        } else if (currentUrl.includes('github.com')) {
            // Update existing HTTPS URL
            const repoPath = currentUrl.split('github.com/')[1]?.replace('.git', '');
            if (repoPath) {
                newUrl = `https://${username}:${token}@github.com/${repoPath}.git`;
            } else {
                throw new Error('Could not parse repository URL');
            }
        } else {
            // Not a GitHub URL, skip
            return;
        }

        // Update the remote URL
        await execPromise(`git remote set-url ${remoteName} "${newUrl}"`, {
            cwd: workspaceRoot
        });
    } catch (error: any) {
        // Don't throw - this is optional functionality
    }
}

/**
 * Gets the current git remote URL
 */
export async function getRemoteUrl(remoteName: string = 'origin'): Promise<string | null> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return null;
    }

    try {
        const { stdout } = await execPromise(`git remote get-url ${remoteName}`, {
            cwd: workspaceRoot
        });
        return stdout.trim();
    } catch (error) {
        return null;
    }
}

/**
 * Parses a GitHub URL to extract owner and repo name
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    try {
        // Handle SSH URLs: git@github.com:owner/repo.git
        if (url.startsWith('git@github.com:')) {
            const parts = url.replace('git@github.com:', '').replace('.git', '').split('/');
            if (parts.length === 2) {
                return { owner: parts[0], repo: parts[1] };
            }
        }

        // Handle HTTPS URLs: https://github.com/owner/repo.git
        if (url.includes('github.com/')) {
            const parts = url.split('github.com/')[1]?.replace('.git', '').split('/');
            if (parts && parts.length >= 2) {
                return { owner: parts[0], repo: parts[1] };
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Removes credentials from git remote URL
 */
export async function removeCredentialsFromRemote(remoteName: string = 'origin'): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return;
    }

    try {
        const currentUrl = await getRemoteUrl(remoteName);
        if (!currentUrl) {
            return;
        }

        // Remove embedded credentials
        let cleanUrl = currentUrl;

        // Remove credentials from HTTPS URLs
        if (cleanUrl.includes('@github.com')) {
            const match = cleanUrl.match(/https:\/\/.*@github.com\/(.+)/);
            if (match) {
                cleanUrl = `https://github.com/${match[1]}`;
            }
        }

        if (cleanUrl !== currentUrl) {
            await execPromise(`git remote set-url ${remoteName} "${cleanUrl}"`, {
                cwd: workspaceRoot
            });
        }
    } catch (error) {
        // Silent failure - not critical
    }
}

