// Class ConflictPetViewProvider implements vscode.WebviewViewProvider
// In resolveWebviewView:
// set webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] }
// render HTML containing <img id="pet" src="...">
// Add method setConflictState(hasConflict: boolean) that updates webview HTML (or posts a message to swap image src

import * as vscode from 'vscode';

export class ConflictPetViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mc-hammer.conflictPetView';

    private _view?: vscode.WebviewView;
    private _hasConflict = false;
    private _isResolvingConflict = false;

    constructor(private readonly extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };

        webviewView.webview.html = this.getHtml(webviewView.webview, this._hasConflict);
    }

    public setConflictState(hasConflict: boolean): void {
        this._hasConflict = hasConflict;

        if (!this._view) {
            return;
        }

        this._view.webview.html = this.getHtml(this._view.webview, hasConflict);
    }

    private getHtml(webview: vscode.Webview, hasConflict: boolean): string {
        const gifPath = hasConflict ? 'ralph.gif' : 'felix.gif';
        const gifUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', gifPath),
        );
        const label = hasConflict ? 'Merge conflict detected' : 'No merge conflict';

        const petClass = hasConflict ? 'pet' : 'pet pet-felix';
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        body {
            margin: 0;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
        }
        .pet {
            width: min(100%, 220px);
            height: auto;
            object-fit: contain;
        }
        .pet-felix {
            width: min(100%, 340px);
        }
        .status {
            font-size: 12px;
            opacity: 0.9;
            text-align: center;
        }
    </style>
</head>
<body>
    <img class="${petClass}" src="${gifUri}" alt="${label}" />
    <div class="status">${hasConflict ? 'Merge Conflict Detected' : 'No Merge Conflicts'}</div>
</body>
</html>`;
    }
}