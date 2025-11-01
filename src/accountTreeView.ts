import * as vscode from 'vscode';
import { GitHubAccount } from './types';
import { loadAccounts } from './accountManager';
import { getCurrentGitUser } from './gitManager';

/**
 * Tree item representing an account in the sidebar
 */
class AccountTreeItem extends vscode.TreeItem {
    constructor(
        public readonly account: GitHubAccount,
        public readonly isCurrent: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(account.label, collapsibleState);

        this.description = account.email;
        this.tooltip = `${account.name}\n${account.email}`;

        // Set icon and styling
        if (isCurrent) {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'));
            this.contextValue = 'currentAccount';
        } else {
            this.iconPath = new vscode.ThemeIcon('account');
            this.contextValue = 'account';
        }

        // Command to execute when clicked
        this.command = {
            command: 'gitshift.switchToAccount',
            title: 'Switch to Account',
            arguments: [account]
        };
    }
}

/**
 * Tree data provider for GitHub accounts
 */
export class AccountTreeProvider implements vscode.TreeDataProvider<AccountTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AccountTreeItem | undefined | null | void> =
        new vscode.EventEmitter<AccountTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AccountTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: AccountTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (accounts list)
     */
    async getChildren(element?: AccountTreeItem): Promise<AccountTreeItem[]> {
        if (element) {
            return [];
        }

        try {
            const accounts = await loadAccounts();
            const currentUser = await getCurrentGitUser();

            if (accounts.length === 0) {
                return [];
            }

            return accounts.map((account) => {
                const isCurrent = Boolean(
                    currentUser &&
                    currentUser.name === account.name &&
                    currentUser.email === account.email
                );

                return new AccountTreeItem(
                    account,
                    isCurrent,
                    vscode.TreeItemCollapsibleState.None
                );
            });
        } catch (error) {
            console.error('Failed to load accounts for tree view:', error);
            return [];
        }
    }
}

/**
 * Creates and registers the account tree view
 * Note: The tree view UI has been replaced by contributionsWebview, but we keep
 * the provider for refresh functionality compatibility
 */
export function createAccountTreeView(_context: vscode.ExtensionContext): AccountTreeProvider {
    const treeProvider = new AccountTreeProvider();

    // Tree view has been replaced by contributionsWebview in package.json
    // No longer creating the tree view to avoid "No view is registered" errors
    // The provider is still returned for backward compatibility with refresh calls

    return treeProvider;
}

