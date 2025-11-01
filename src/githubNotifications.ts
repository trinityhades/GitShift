// vscode import removed - not currently used

/**
 * GitHub notification information
 */
export interface GitHubNotification {
    id: string;
    unread: boolean;
    reason: string; // 'mention', 'review_requested', 'comment', etc.
    subject: {
        title: string;
        url: string;
        type: string; // 'Issue', 'PullRequest', 'Release', etc.
    };
    repository: {
        full_name: string;
        owner: { login: string };
        name: string;
    };
    updated_at: string;
    last_read_at: string | null;
}

/**
 * Fetches GitHub notifications for the authenticated user
 * @param token - GitHub access token
 * @param all - If true, fetch all notifications (including read ones). Default: false (only unread)
 * @returns Array of notifications
 */
export async function fetchNotifications(token: string, all: boolean = false): Promise<GitHubNotification[]> {
    try {
        const url = all
            ? 'https://api.github.com/notifications?all=true&per_page=50'
            : 'https://api.github.com/notifications?per_page=50';

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        if (!response.ok) {
            // Check for permission/scope errors
            if (response.status === 403) {
                throw new Error('Insufficient permissions: Your token needs the "notifications" scope. Please sign in again to grant this permission.');
            } else if (response.status === 401) {
                throw new Error('Authentication failed: Your token may be invalid or expired.');
            }
            throw new Error(`GitHub API error (${response.status}): ${response.statusText}`);
        }

        const notifications = await response.json() as any[];

        // Transform the API response to our interface
        return notifications.map(notif => ({
            id: notif.id,
            unread: notif.unread,
            reason: notif.reason,
            subject: {
                title: notif.subject.title,
                url: notif.subject.url.replace('https://api.github.com/repos/', 'https://github.com/').replace('/pulls/', '/pull/'),
                type: notif.subject.type
            },
            repository: {
                full_name: notif.repository.full_name,
                owner: { login: notif.repository.owner.login },
                name: notif.repository.name
            },
            updated_at: notif.updated_at,
            last_read_at: notif.last_read_at
        }));
    } catch (error: any) {
        throw new Error(`Failed to fetch notifications: ${error.message}`);
    }
}

/**
 * Marks a specific notification as read
 * @param token - GitHub access token
 * @param notificationId - The ID of the notification to mark as read
 */
export async function markNotificationAsRead(token: string, notificationId: string): Promise<void> {
    try {
        const response = await fetch(`https://api.github.com/notifications/threads/${notificationId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`GitHub API error (${response.status}): ${response.statusText} ${errorText}`);
        }
    } catch (error: any) {
        throw new Error(`Failed to mark notification as read: ${error.message}`);
    }
}

/**
 * Marks all notifications as read
 * @param token - GitHub access token
 */
export async function markAllNotificationsAsRead(token: string): Promise<void> {
    try {
        const response = await fetch('https://api.github.com/notifications', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'VSCode-GitShift'
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`GitHub API error (${response.status}): ${response.statusText} ${errorText}`);
        }
    } catch (error: any) {
        throw new Error(`Failed to mark all notifications as read: ${error.message}`);
    }
}

