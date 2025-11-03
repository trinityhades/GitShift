/**
 * GitShift - GitHub Authentication Module
 * Copyright (c) 2025 mikeeeyy04
 * https://github.com/mikeeeyy04/GitShift
 * 
 * MIT License - See LICENSE file for details
 */

import * as vscode from 'vscode';

/**
 * GitHub session information
 */
export interface GitHubSession {
    id: string;
    accessToken: string;
    account: {
        label: string;  // Email or username
        id: string;     // GitHub user ID
    };
    scopes: string[];
}

// Secret storage for token vault (initialized from extension activate)
let secretStorage: vscode.SecretStorage | null = null;
let globalState: vscode.Memento | null = null;

export function initAuthSecrets(context: vscode.ExtensionContext) {
    secretStorage = context.secrets;
    globalState = context.globalState;
}

/**
 * Gets the list of all usernames that have stored tokens
 * This is maintained globally so all workspaces can access all tokens
 */
async function getTokenRegistry(): Promise<string[]> {
    if (!globalState) throw new Error('Global state not initialized');
    return globalState.get('github-token-registry', []);
}

/**
 * Adds a username to the token registry
 */
async function registerToken(username: string): Promise<void> {
    if (!globalState) throw new Error('Global state not initialized');
    const registry = await getTokenRegistry();
    if (!registry.includes(username)) {
        registry.push(username);
        await globalState.update('github-token-registry', registry);
    }
}

/**
 * Removes a username from the token registry
 */
async function unregisterToken(username: string): Promise<void> {
    if (!globalState) throw new Error('Global state not initialized');
    const registry = await getTokenRegistry();
    const filtered = registry.filter(u => u !== username);
    await globalState.update('github-token-registry', filtered);
}

/**
 * Gets all stored tokens with their usernames
 * Returns array of {username, token} objects
 */
export async function getAllStoredTokens(): Promise<Array<{ username: string; token: string }>> {
    const registry = await getTokenRegistry();
    const tokens: Array<{ username: string; token: string }> = [];

    for (const username of registry) {
        const token = await getGitHubToken(username);
        if (token) {
            tokens.push({ username, token });
        } else {
            // Token was deleted but not unregistered, clean up
            await unregisterToken(username);
        }
    }

    return tokens;
}

export async function storeGitHubToken(username: string, token: string): Promise<void> {
    if (!secretStorage) throw new Error('Secret storage not initialized');
    await secretStorage.store(`github-token-${username}`, token);
    // Register token in global registry so other workspaces can find it
    await registerToken(username);
}

export async function getGitHubToken(username: string): Promise<string | undefined> {
    if (!secretStorage) throw new Error('Secret storage not initialized');
    return await secretStorage.get(`github-token-${username}`) || undefined;
}

export async function deleteGitHubToken(username: string): Promise<void> {
    if (!secretStorage) throw new Error('Secret storage not initialized');
    await secretStorage.delete(`github-token-${username}`);
    // Unregister token from global registry
    await unregisterToken(username);
}

/**
 * Signs in to GitHub using VS Code's authentication API
 * @param forceNew - If true, forces a new sign-in prompt
 */
export async function signInToGitHub(forceNew: boolean = false): Promise<GitHubSession | null> {
    try {
        const options = forceNew
            ? { forceNewSession: true }
            : { createIfNone: true };

        const session = await vscode.authentication.getSession('github', ['repo', 'user:email', 'read:user', 'workflow', 'notifications'], options);

        if (!session) {
            return null;
        }

        // Accept whatever account the user chose - we don't validate
        return {
            id: session.id,
            accessToken: session.accessToken,
            account: {
                label: session.account.label,
                id: session.account.id
            },
            scopes: [...session.scopes]
        };
    } catch (error: any) {
        // User cancelled or closed the dialog
        if (error.message?.includes('User did not consent') ||
            error.message?.includes('Cancelled')) {
            return null;
        }

        vscode.window.showErrorMessage(`Failed to sign in to GitHub: ${error.message}`);
        return null;
    }
}

/**
 * Gets a GitHub session by account ID
 * @param accountId - The VS Code account ID
 */
export async function getGitHubSessionByAccountId(accountId: string): Promise<GitHubSession | null> {
    try {
        // First, try to get the current session silently
        const session = await vscode.authentication.getSession('github', ['repo', 'user:email', 'read:user', 'workflow', 'notifications'], {
            createIfNone: false,
            clearSessionPreference: false,
            silent: true
        });

        // Check if the current session matches the requested account
        if (session && session.account.id === accountId) {
            return {
                id: session.id,
                accessToken: session.accessToken,
                account: {
                    label: session.account.label,
                    id: session.account.id
                },
                scopes: [...session.scopes]
            };
        }

        // If the current session doesn't match, return null
        // Note: VS Code's authentication API doesn't provide a way to get sessions
        // for multiple accounts simultaneously. The calling code should fall back
        // to using stored tokens from secrets storage.
        return null;
    } catch (error) {
        console.error('Failed to get GitHub session:', error);
        return null;
    }
}

/**
 * Gets the current active GitHub session
 * Note: VS Code API only allows getting the current session, not all sessions
 */
export async function getGitHubSessions(): Promise<GitHubSession[]> {
    try {
        // Try to get the current GitHub session silently
        // We request 'repo', 'user:email', 'read:user', 'workflow', and 'notifications' scopes to get the full session
        const session = await vscode.authentication.getSession('github', ['repo', 'user:email', 'read:user', 'workflow', 'notifications'], {
            createIfNone: false,
            silent: true
        });

        if (!session) {
            return [];
        }

        return [{
            id: session.id,
            accessToken: session.accessToken,
            account: {
                label: session.account.label,
                id: session.account.id
            },
            scopes: [...session.scopes]
        }];
    } catch (error) {
        console.error('Failed to get GitHub sessions:', error);
        return [];
    }
}

/**
 * Gets the current GitHub session with additional scopes if needed
 * This can trigger a user prompt to sign in or grant additional permissions
 */
export async function getCurrentGitHubSessionWithPrompt(): Promise<GitHubSession | null> {
    try {
        const session = await vscode.authentication.getSession('github', ['repo', 'user:email', 'read:user', 'workflow', 'notifications'], {
            createIfNone: true,
            silent: false
        });

        if (!session) {
            return null;
        }

        return {
            id: session.id,
            accessToken: session.accessToken,
            account: {
                label: session.account.label,
                id: session.account.id
            },
            scopes: [...session.scopes]
        };
    } catch (error) {
        console.error('Failed to get GitHub session:', error);
        return null;
    }
}

/**
 * Gets GitHub user information using the access token
 */
export async function getGitHubUser(accessToken: string): Promise<any> {
    try {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.statusText}`);
        }

        return await response.json();
    } catch (error: any) {
        throw new Error(`Failed to fetch GitHub user: ${error.message}`);
    }
}

/**
 * Validates a GitHub token by calling /user and reading scopes header
 */
export async function validateGitHubToken(token: string): Promise<{ user: any; scopes: string[] }> {
    const response = await fetch('https://api.github.com/user', {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'VSCode-GitShift'
        }
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`GitHub API error (${response.status}): ${response.statusText} ${text}`);
    }
    const scopesHeader = response.headers.get('x-oauth-scopes') || '';
    const scopes = scopesHeader.split(',').map(s => s.trim()).filter(Boolean);
    const user = await response.json();
    return { user, scopes };
}

/**
 * Gets GitHub user emails using the access token
 * Returns empty array if emails cannot be fetched (e.g., missing user:email scope or private email settings)
 */
export async function getGitHubEmails(accessToken: string): Promise<Array<{ email: string; primary: boolean; verified: boolean }>> {
    try {
        const response = await fetch('https://api.github.com/user/emails', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        if (!response.ok) {
            // If 404 or other error, return empty array (token might not have user:email scope)
            // This is acceptable - we can fallback to using the user's email from the /user endpoint
            if (response.status === 404) {
                return [];
            }
            throw new Error(`GitHub API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data as Array<{ email: string; primary: boolean; verified: boolean }>;
    } catch (error: any) {
        // If error occurs, return empty array instead of throwing
        // The caller should handle missing emails gracefully
        console.warn('Failed to fetch GitHub emails:', error.message);
        return [];
    }
}

/**
 * Checks if the user has access to a specific repository
 */
export async function checkRepoAccess(accessToken: string, owner: string, repo: string): Promise<boolean> {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        return response.ok;
    } catch (error) {
        return false;
    }
}

/**
 * Creates a new GitHub repository
 */
export async function createGitHubRepository(accessToken: string, name: string, description: string = '', privateRepo: boolean = false): Promise<{ html_url: string; clone_url: string; name: string; owner: { login: string } }> {
    try {
        const response = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'VSCode-GitShift'
            },
            body: JSON.stringify({
                name,
                description,
                private: privateRepo,
                auto_init: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`GitHub API error (${response.status}): ${response.statusText} ${errorText}`);
        }

        const data = await response.json() as { html_url: string; clone_url: string; name: string; owner: { login: string } };
        return data;
    } catch (error: any) {
        throw new Error(`Failed to create GitHub repository: ${error.message}`);
    }
}

/**
 * Checks if the user has push access to a specific repository
 * Uses the /repos endpoint which returns permissions for the authenticated user
 */
export async function checkCollaboratorAccess(accessToken: string, owner: string, repo: string, username: string): Promise<boolean> {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json() as any;

        // Check if the permissions object exists and the user has push or admin permissions
        if (data.permissions) {
            return data.permissions.push === true || data.permissions.admin === true;
        }

        // Fallback: if it's the owner, they have push access
        return data.owner && data.owner.login === username;
    } catch (error) {
        return false;
    }
}

/**
 * Signs out from a specific GitHub session
 */
export async function signOutFromGitHub(_sessionId: string): Promise<void> {
    try {
        // Note: VS Code doesn't provide a direct way to remove sessions
        // Sessions are managed by VS Code's authentication provider
        vscode.window.showInformationMessage(
            'To sign out, please use VS Code\'s Accounts menu in the bottom left corner.'
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to sign out: ${error.message}`);
    }
}

