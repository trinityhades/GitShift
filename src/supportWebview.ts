import * as vscode from 'vscode';

/**
 * Provides the webview content for the Support tab
 */
export class SupportProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) { }

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

    webviewView.webview.html = this._getHtmlContent();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'openExternal':
          if (data.url) {
            await vscode.env.openExternal(vscode.Uri.parse(data.url));
          }
          break;
      }
    });
  }

  public refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtmlContent();
    }
  }

  private _getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support GitShift</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: transparent;
      color: var(--vscode-foreground);
      padding: clamp(8px, 2.5vw, 16px);
      font-size: clamp(12px, 3vw, 13px);
      line-height: 1.5;
    }

    .donation-section {
      padding: clamp(12px, 3vw, 16px);
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      text-align: center;
    }

    .donation-section h4 {
      font-size: clamp(11px, 2.8vw, 12px);
      font-weight: 500;
      margin-bottom: clamp(4px, 1vw, 6px);
      color: var(--vscode-foreground);
      letter-spacing: 0.3px;
    }

    .donation-section p {
      font-size: clamp(9px, 2.3vw, 10px);
      color: var(--vscode-descriptionForeground);
      margin-bottom: clamp(10px, 2.5vw, 12px);
      line-height: 1.4;
    }

    .donation-link {
      display: inline-block;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }

    .donation-link:hover {
      transform: translateY(-2px);
      opacity: 0.9;
    }

    .donation-link img {
      height: clamp(32px, 8vw, 40px);
      border-radius: 4px;
    }

    @media (max-width: 220px) {
      .donation-section {
        padding: 10px;
      }
      
      .donation-link img {
        height: 28px;
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
  <div class="donation-section">
    <h4>Support GitShift</h4>
    <p>If you find this extension helpful, consider supporting its development!</p>
    <a href="https://www.buymeacoffee.com/mikeeeyy" target="_blank" class="donation-link" onclick="openDonation(event)">
      <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" />
    </a>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function openDonation(event) {
      event.preventDefault();
      vscode.postMessage({ 
        type: 'openExternal', 
        url: 'https://www.buymeacoffee.com/mikeeeyy' 
      });
    }
  </script>
</body>
</html>`;
  }
}

