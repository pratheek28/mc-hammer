import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

// ─── State ────────────────────────────────────────────────────────────────────

let hammerTerminal: vscode.Terminal | undefined;
let reactTerminal: vscode.Terminal | undefined;
const socket: WebSocket = new WebSocket("ws://127.0.0.1:8765");

// ─── Terminal Helpers ─────────────────────────────────────────────────────────

// Reuses the same named terminal across calls; recreates it if it was closed
function getTerminal(): vscode.Terminal {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
}

// ─── Backend Communication ────────────────────────────────────────────────────

function sendToBackend(data: string) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
    } else {
        socket.addEventListener('open', () => socket.send(data), { once: true });
    }
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

// Opens a document and shows/hides the status bar item based on conflict markers
async function checkDocumentForConflicts(
    uri: vscode.Uri,
    conflictStatusBar: vscode.StatusBarItem
) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.getText().includes('<<<<<<<')) {
        conflictStatusBar.show();
        vscode.window.showInformationMessage(
            `MC Hammer detected a merge conflict in ${uri.fsPath}`
        );
    } else {
        conflictStatusBar.hide();
    }
}

// Uses git diff to get conflicted Python files, then scans each for conflict
// markers and finds the enclosing function.
// Returns: { filePath: [functionName, ...] }
async function getConflictedFunctions(): Promise<Record<string, string[]>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log('[MC Hammer] workspaceFolders:', workspaceFolders?.map(f => f.uri.fsPath));

    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('MC Hammer: No workspace folder is open.');
        return {};
    }

    const cwd = workspaceFolders[0].uri.fsPath;
    console.log('[MC Hammer] cwd:', cwd);
    const result: Record<string, string[]> = {};

    return new Promise((resolve) => {
        cp.exec('git diff --name-only --diff-filter=U', { cwd }, async (err, stdout) => {
            console.log('[MC Hammer] git diff err:', err);
            console.log('[MC Hammer] git diff stdout:', stdout);

            if (err || !stdout.trim()) {
                console.log('[MC Hammer] early exit - no conflicts or git error');
                resolve(result);
                return;
            }

            const conflictedFiles = stdout.trim().split('\n').filter(f => f.endsWith('.py'));
            console.log('[MC Hammer] conflicted python files:', conflictedFiles);

            for (const filePath of conflictedFiles) {
                const fullPath = `${cwd}/${filePath}`;
                console.log('[MC Hammer] scanning file:', fullPath);

                const doc = await vscode.workspace.openTextDocument(fullPath);
                const lines = doc.getText().split('\n');
                const functions: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('<<<<<<<')) {
                        console.log('[MC Hammer] conflict marker found at line', i);
                        for (let j = i; j >= 0; j--) {
                            if (lines[j].trimStart().startsWith('def ')) {
                                const funcName = lines[j].trim().split('(')[0].replace('def ', '');
                                console.log('[MC Hammer] enclosing function found:', funcName);
                                if (!functions.includes(funcName)) {
                                    functions.push(funcName);
                                }
                                break;
                            }
                        }
                    }
                }

                console.log('[MC Hammer] functions with conflicts in', filePath, ':', functions);
                if (functions.length > 0) {
                    result[filePath] = functions;
                }
            }

            console.log('[MC Hammer] final result:', JSON.stringify(result, null, 2));
            resolve(result);
        });
    });
}

// ─── UI / React Preview ───────────────────────────────────────────────────────

function startReactAndPreview(context: vscode.ExtensionContext): void {
    if (!reactTerminal || reactTerminal.exitStatus !== undefined) {
        const dependencyGraphUIPath = path.join(context.extensionPath, 'dependency-graph-ui');
        reactTerminal = vscode.window.createTerminal({
            name: "Dependency Graph UI",
            cwd: dependencyGraphUIPath
        });
        reactTerminal.sendText('npm run dev');
    }

    setTimeout(() => {
        vscode.commands.executeCommand('simpleBrowser.show', 'http://localhost:5173');
    }, 4000);
}

// ─── Command Approval Flow ────────────────────────────────────────────────────

// Shows a modal asking the user to approve or reject a command before running it.
// Returns 'ran', 'rejected', or 'dismissed'.
export async function runApprovedCommand(
    command: string,
    context: vscode.ExtensionContext
): Promise<'ran' | 'rejected' | 'dismissed'> {
    const result = await vscode.window.showInformationMessage(
        `MC Hammer wants to run: ${command}`,
        { modal: true },
        'Run it',
        'Reject'
    );

    if (result === 'Run it') {
        const terminal = getTerminal();
        terminal.show();
        terminal.sendText(command);

        const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (dir) {
            vscode.env.clipboard.writeText(dir);
            vscode.window.showInformationMessage(`Copied dir: ${dir}`);
            sendToBackend(dir);
            vscode.window.showInformationMessage('Sent directory to backend!');
            startReactAndPreview(context);
        } else {
            vscode.window.showInformationMessage('Failed');
        }
        return 'ran';
    }

    if (result === 'Reject') {
        return 'rejected';
    }

    return 'dismissed';
}

// ─── Button Handler ───────────────────────────────────────────────────────────

async function buttonClicked() {
    const terminal = getTerminal();
    terminal.show();
    terminal.sendText('git diff --name-only --diff-filter=U');

    const conflictedFunctions = await getConflictedFunctions();

    if (Object.keys(conflictedFunctions).length === 0) {
        vscode.window.showInformationMessage('No merge conflicts detected in Python files.');
        return;
    }

    vscode.window.showInformationMessage(
        `MC Hammer found conflicts in: ${Object.keys(conflictedFunctions).join(', ')}`
    );

    sendToBackend(JSON.stringify(conflictedFunctions));
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "mc-hammer" is now active!');

    // Status bar item — hidden until a conflict is detected
    const conflictStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    conflictStatusBar.text = '🔨 MC Hammer: Merge Conflict Detected';
    conflictStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    conflictStatusBar.command = 'mc-hammer.buttonClicked';
    conflictStatusBar.tooltip = 'Click to run MC Hammer on merge conflicts';
    conflictStatusBar.hide();
    context.subscriptions.push(conflictStatusBar);

    // Scan all already-open Python files at activation time
    const openDocs = vscode.workspace.textDocuments.filter(d => d.fileName.endsWith('.py'));
    for (const doc of openDocs) {
        checkDocumentForConflicts(doc.uri, conflictStatusBar);
    }

    // Watch for Python files being saved/changed on disk
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.py');
    watcher.onDidChange(uri => checkDocumentForConflicts(uri, conflictStatusBar));
    context.subscriptions.push(watcher);

    // Also check when a Python file is newly opened in the editor
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.fileName.endsWith('.py')) {
                checkDocumentForConflicts(doc.uri, conflictStatusBar);
            }
        })
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('mc-hammer.helloWorld', () => {
            vscode.window.showInformationMessage('Hello! from mc-hammer!');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mc-hammer.buttonClicked', () => {
            buttonClicked().catch(err => {
                vscode.window.showErrorMessage(`MC Hammer error: ${err.message}`);
            });
        })
    );
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate() {
    hammerTerminal?.dispose();
    reactTerminal?.dispose();
}