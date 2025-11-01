import * as vscode from 'vscode';
import { execSync } from 'child_process';

export class CommitDetailsPanel {
    private static currentPanel: CommitDetailsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _currentCommitHash: string = '';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, commitHash: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._currentCommitHash = commitHash;

        this._panel.webview.html = this._getLoadingHtml();
        this._loadCommitDetails(commitHash);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'toggleDiff':
                        await this._sendFileDiff(this._currentCommitHash, message.file);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static show(extensionUri: vscode.Uri, commitHash: string) {
        const column = vscode.ViewColumn.One;

        // Reuse existing panel if available
        if (CommitDetailsPanel.currentPanel) {
            CommitDetailsPanel.currentPanel._panel.reveal(column);
            CommitDetailsPanel.currentPanel._updateCommit(commitHash);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'commitDetails',
            `Commit ${commitHash}`,
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        CommitDetailsPanel.currentPanel = new CommitDetailsPanel(panel, extensionUri, commitHash);
    }

    private async _updateCommit(commitHash: string) {
        // Update the current commit hash
        this._currentCommitHash = commitHash;

        // Show loading state
        this._panel.webview.html = this._getLoadingHtml();

        // Load fresh commit details
        await this._loadCommitDetails(commitHash);
    }

    private async _loadCommitDetails(commitHash: string) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            // Get the full commit hash first
            let fullCommitHash = commitHash;
            try {
                fullCommitHash = execSync(`git rev-parse ${commitHash}`, {
                    cwd: workspaceRoot,
                    encoding: 'utf8'
                }).toString().trim();
            } catch (error) {
                // If rev-parse fails, use the original hash
            }

            // Get commit info
            const commitInfo = execSync(`git show --no-patch --pretty=format:"%H%n%s%n%an%n%ae%n%ar%n%ai" ${fullCommitHash}`, {
                cwd: workspaceRoot,
                encoding: 'utf8'
            }).toString().split('\n');

            const commit = {
                hash: commitInfo[0],
                message: commitInfo[1],
                author: commitInfo[2],
                email: commitInfo[3],
                dateRelative: commitInfo[4],
                dateAbsolute: commitInfo[5]
            };

            // Update panel title with actual commit hash
            this._panel.title = `Commit ${commit.hash.substring(0, 7)}`;

            // Get list of files changed
            const filesOutput = execSync(`git show --name-status --pretty=format: ${fullCommitHash}`, {
                cwd: workspaceRoot,
                encoding: 'utf8'
            }).toString();

            const files = filesOutput.split('\n')
                .filter(f => f.trim())
                .map(line => {
                    const parts = line.trim().split('\t');
                    const status = parts[0];
                    const filePath = parts[1];

                    let statusText = 'Modified';
                    let statusClass = 'modified';
                    let statusIcon = 'codicon-edit';

                    if (status === 'A') {
                        statusText = 'Added';
                        statusClass = 'added';
                        statusIcon = 'codicon-add';
                    } else if (status === 'D') {
                        statusText = 'Deleted';
                        statusClass = 'deleted';
                        statusIcon = 'codicon-trash';
                    } else if (status === 'M') {
                        statusText = 'Modified';
                        statusClass = 'modified';
                        statusIcon = 'codicon-edit';
                    } else if (status.startsWith('R')) {
                        statusText = 'Renamed';
                        statusClass = 'renamed';
                        statusIcon = 'codicon-file-symlink-file';
                    }

                    return {
                        path: filePath,
                        status: statusText,
                        statusClass,
                        statusIcon
                    };
                });

            // Get diff stats
            const statsOutput = execSync(`git show --stat --pretty=format: ${fullCommitHash}`, {
                cwd: workspaceRoot,
                encoding: 'utf8'
            }).toString();

            const statsMatch = statsOutput.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
            const stats = {
                filesChanged: statsMatch ? parseInt(statsMatch[1]) : files.length,
                insertions: statsMatch && statsMatch[2] ? parseInt(statsMatch[2]) : 0,
                deletions: statsMatch && statsMatch[3] ? parseInt(statsMatch[3]) : 0
            };

            this._panel.webview.html = this._getHtmlContent(commit, files, stats);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load commit details: ${error.message}`);
        }
    }

    private async _sendFileDiff(commitHash: string, filePath: string) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            // Normalize file path for git (use forward slashes)
            const gitFilePath = filePath.replace(/\\/g, '/');

            // Get the full commit hash first
            let fullCommitHash = commitHash;
            try {
                fullCommitHash = execSync(`git rev-parse ${commitHash}`, {
                    cwd: workspaceRoot,
                    encoding: 'utf8'
                }).toString().trim();
            } catch (error) {
                // If rev-parse fails, use the original hash
            }

            // Method: Get the entire commit and extract this file's diff
            try {
                const fullDiff = execSync(`git show ${fullCommitHash}`, {
                    cwd: workspaceRoot,
                    encoding: 'utf8',
                    maxBuffer: 10 * 1024 * 1024
                }).toString();

                // Extract only the diff for this specific file
                const lines = fullDiff.split('\n');
                let capturing = false;
                let capturedLines: string[] = [];
                const foundFiles: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // Check if this is the start of our file's diff
                    // Git uses format: diff --git a/path/file b/path/file
                    if (line.startsWith('diff --git')) {
                        const match = line.match(/diff --git a\/(.*?) b\/(.*?)$/);
                        if (match) {
                            const fileInDiff = match[1];
                            foundFiles.push(fileInDiff);

                            // Normalize both paths for comparison
                            const normalizedFileInDiff = fileInDiff.replace(/\\/g, '/').toLowerCase();
                            const normalizedGitFilePath = gitFilePath.replace(/\\/g, '/').toLowerCase();
                            const normalizedFilePath = filePath.replace(/\\/g, '/').toLowerCase();

                            // Check if this matches our file (case-insensitive)
                            if (normalizedFileInDiff === normalizedGitFilePath ||
                                normalizedFileInDiff === normalizedFilePath ||
                                fileInDiff === gitFilePath ||
                                fileInDiff === filePath) {
                                capturing = true;
                                capturedLines = [line];
                                continue;
                            } else if (capturing) {
                                // We hit a different file, stop capturing
                                break;
                            }
                        }
                    }

                    if (capturing) {
                        capturedLines.push(line);
                    }
                }

                if (capturedLines.length > 1) {  // More than just the diff --git line
                    this._panel.webview.postMessage({
                        type: 'showDiff',
                        file: filePath,
                        diff: capturedLines.join('\n')
                    });
                    return;
                }

                // If we didn't find it, provide debug info
                const debugInfo = `Looking for: "${filePath}" or "${gitFilePath}"\nFiles found in commit: ${foundFiles.join(', ') || 'none'}`;
                this._panel.webview.postMessage({
                    type: 'showDiff',
                    file: filePath,
                    diff: `No changes found for this file in commit ${commitHash.substring(0, 7)}.\n\n${debugInfo}\n\nThis might be because:\n- File path mismatch\n- The file was renamed\n- The file path changed`
                });

            } catch (error: any) {
                this._panel.webview.postMessage({
                    type: 'showDiff',
                    file: filePath,
                    diff: `Error loading diff: ${error.message}`
                });
            }
        } catch (error: any) {
            this._panel.webview.postMessage({
                type: 'showDiff',
                file: filePath,
                diff: `Error loading diff: ${error.message}`
            });
        }
    }

    private _getLoadingHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading Commit</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
    </style>
</head>
<body>
    <div>Loading commit details...</div>
</body>
</html>`;
    }

    private _getHtmlContent(commit: any, files: any[], stats: any): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css" rel="stylesheet" />
    <title>Commit ${commit.hash.substring(0, 7)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 20px;
            font-size: 13px;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .commit-header {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .commit-message {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            line-height: 1.4;
        }

        .commit-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .commit-hash {
            font-family: 'Consolas', 'Courier New', monospace;
            background: var(--vscode-editor-background);
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }

        .stats-bar {
            display: flex;
            gap: 20px;
            padding: 16px 20px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .stat-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 500;
        }

        .stat-item.additions {
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .stat-item.deletions {
            color: var(--vscode-gitDecoration-deletedResourceForeground);
        }

        .files-section {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
        }

        .section-header {
            padding: 16px 20px;
            font-size: 14px;
            font-weight: 600;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .file-item {
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .file-item:last-child {
            border-bottom: none;
        }

        .file-header {
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .file-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .file-header.expanded .expand-icon {
            transform: rotate(90deg);
        }

        .diff-container {
            display: none;
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }

        .diff-container.expanded {
            display: block;
            max-height: 2000px;
        }

        .diff-loading {
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }

        .diff-content {
            padding: 0;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.5;
        }

        .diff-line {
            padding: 2px 12px;
            white-space: pre;
            display: flex;
        }

        .diff-line.added {
            background: rgba(16, 185, 129, 0.15);
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .diff-line.deleted {
            background: rgba(239, 68, 68, 0.15);
            color: var(--vscode-gitDecoration-deletedResourceForeground);
        }

        .diff-line.context {
            color: var(--vscode-editor-foreground);
        }

        .diff-line.hunk {
            background: rgba(59, 130, 246, 0.15);
            color: var(--vscode-textLink-foreground);
            font-weight: 500;
        }

        .line-number {
            display: inline-block;
            width: 50px;
            text-align: right;
            padding-right: 12px;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none;
        }

        .file-status {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .file-status.added {
            background: rgba(var(--vscode-gitDecoration-addedResourceForeground), 0.15);
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .file-status.modified {
            background: rgba(var(--vscode-gitDecoration-modifiedResourceForeground), 0.15);
            color: var(--vscode-gitDecoration-modifiedResourceForeground);
        }

        .file-status.deleted {
            background: rgba(var(--vscode-gitDecoration-deletedResourceForeground), 0.15);
            color: var(--vscode-gitDecoration-deletedResourceForeground);
        }

        .file-status.renamed {
            background: rgba(var(--vscode-gitDecoration-renamedResourceForeground), 0.15);
            color: var(--vscode-gitDecoration-renamedResourceForeground);
        }

        .file-path {
            flex: 1;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 12px;
        }

        .file-name {
            font-weight: 500;
        }

        .file-dir {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            margin-top: 2px;
        }

        .expand-icon {
            color: var(--vscode-descriptionForeground);
            transition: transform 0.2s ease;
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state i {
            font-size: 48px;
            opacity: 0.3;
            margin-bottom: 12px;
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
    <div class="container">
        <div class="commit-header">
            <div class="commit-message">${this._escapeHtml(commit.message)}</div>
            <div class="commit-meta">
                <div class="meta-item">
                    <i class="codicon codicon-git-commit"></i>
                    <span class="commit-hash">${commit.hash.substring(0, 7)}</span>
                </div>
                <div class="meta-item">
                    <i class="codicon codicon-account"></i>
                    <span>${this._escapeHtml(commit.author)}</span>
                </div>
                <div class="meta-item">
                    <i class="codicon codicon-clock"></i>
                    <span>${commit.dateRelative}</span>
                </div>
            </div>
        </div>

        <div class="stats-bar">
            <div class="stat-item">
                <i class="codicon codicon-file"></i>
                <span>${stats.filesChanged} file${stats.filesChanged !== 1 ? 's' : ''} changed</span>
            </div>
            ${stats.insertions > 0 ? `
                <div class="stat-item additions">
                    <i class="codicon codicon-add"></i>
                    <span>${stats.insertions} addition${stats.insertions !== 1 ? 's' : ''}</span>
                </div>
            ` : ''}
            ${stats.deletions > 0 ? `
                <div class="stat-item deletions">
                    <i class="codicon codicon-remove"></i>
                    <span>${stats.deletions} deletion${stats.deletions !== 1 ? 's' : ''}</span>
                </div>
            ` : ''}
        </div>

        <div class="files-section">
            <div class="section-header">
                <i class="codicon codicon-files"></i>
                <span>Changed Files (${files.length})</span>
            </div>
            ${files.length === 0 ? `
                <div class="empty-state">
                    <i class="codicon codicon-info"></i>
                    <div>No files changed in this commit</div>
                </div>
            ` : files.map((file, index) => `
                <div class="file-item" data-file-index="${index}">
                    <div class="file-header" onclick="toggleDiff('${file.path.replace(/'/g, "\\'")}', ${index})">
                        <span class="file-status ${file.statusClass}">
                            <i class="codicon ${file.statusIcon}"></i>
                            ${file.status}
                        </span>
                        <div class="file-path">
                            <div class="file-name">${this._escapeHtml(file.path.split('/').pop() || file.path)}</div>
                            ${file.path.includes('/') ? `
                                <div class="file-dir">${this._escapeHtml(file.path.substring(0, file.path.lastIndexOf('/')))}</div>
                            ` : ''}
                        </div>
                        <i class="codicon codicon-chevron-right expand-icon"></i>
                    </div>
                    <div class="diff-container" id="diff-${index}">
                        <div class="diff-loading">
                            <i class="codicon codicon-loading codicon-modifier-spin"></i>
                            Loading diff...
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const expandedFiles = new Set();

        function toggleDiff(file, index) {
            const diffContainer = document.getElementById('diff-' + index);
            const fileHeader = diffContainer.previousElementSibling;
            
            if (expandedFiles.has(index)) {
                // Collapse
                diffContainer.classList.remove('expanded');
                fileHeader.classList.remove('expanded');
                expandedFiles.delete(index);
            } else {
                // Expand
                diffContainer.classList.add('expanded');
                fileHeader.classList.add('expanded');
                expandedFiles.add(index);
                
                // Request diff content if not already loaded
                if (!diffContainer.dataset.loaded) {
                    vscode.postMessage({
                        type: 'toggleDiff',
                        file: file
                    });
                    diffContainer.dataset.fileIndex = index;
                    diffContainer.dataset.filePath = file;
                }
            }
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'showDiff') {
                const diffContainers = document.querySelectorAll('.diff-container');
                
                // Find the container for this file
                for (const container of diffContainers) {
                    if (container.dataset.filePath === message.file) {
                        container.dataset.loaded = 'true';
                        container.innerHTML = renderDiff(message.diff);
                        break;
                    }
                }
            }
        });

        function renderDiff(diffText) {
            if (!diffText || diffText.trim() === '') {
                return '<div class="diff-loading">No diff content available</div>';
            }
            
            // Check if it's an error message
            if (diffText.startsWith('ERROR:') || diffText.startsWith('Error loading')) {
                return \`<div class="diff-loading" style="color: var(--vscode-errorForeground);">\${escapeHtml(diffText)}</div>\`;
            }
            
            const lines = diffText.split('\\n');
            let html = '<div class="diff-content">';
            let inDiffSection = false;
            
            lines.forEach((line, index) => {
                let className = 'context';
                let displayLine = escapeHtml(line);
                
                // Check if we've reached the actual diff content
                if (line.startsWith('@@')) {
                    inDiffSection = true;
                    className = 'hunk';
                } else if (!inDiffSection) {
                    // Skip metadata lines before the first @@
                    if (line.startsWith('diff --git') || line.startsWith('index ') || 
                        line.startsWith('---') || line.startsWith('+++') ||
                        line.startsWith('new file') || line.startsWith('deleted file') ||
                        line.startsWith('similarity index') || line.startsWith('rename')) {
                        return;
                    }
                }
                
                // Color the diff lines
                if (inDiffSection) {
                    if (line.startsWith('+') && !line.startsWith('+++')) {
                        className = 'added';
                    } else if (line.startsWith('-') && !line.startsWith('---')) {
                        className = 'deleted';
                    } else if (line.startsWith('@@')) {
                        className = 'hunk';
                    }
                }
                
                html += \`<div class="diff-line \${className}">\${displayLine || '&nbsp;'}</div>\`;
            });
            
            html += '</div>';
            return html;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose() {
        CommitDetailsPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

