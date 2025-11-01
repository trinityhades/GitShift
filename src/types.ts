/**
 * Represents a GitHub account profile
 */
export interface GitHubAccount {
  label: string;
  name: string;
  email: string;
  sessionId?: string;  // VS Code GitHub session ID
  accountId?: string;  // VS Code GitHub account ID (for retrieving session)
  username?: string;   // GitHub username
  avatarUrl?: string;  // GitHub avatar URL
  authenticated?: boolean;  // Whether this account has an active session
}

/**
 * Represents the current git user configuration
 */
export interface GitUser {
  name: string;
  email: string;
}

