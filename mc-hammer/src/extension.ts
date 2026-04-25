import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

let hammerTerminal: vscode.Terminal | undefined;
let reactTerminal: vscode.Terminal | undefined;

const socket: WebSocket = new WebSocket("ws://127.0.0.1:8765");

// uses git diff to get list of conflicted python files, then scans each file
// for conflict markers and finds the enclosing python function
// returns a dict with key = file path, value = list of function names with conflicts
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

async function buttonClicked() {
    const terminal = getTerminal();
    terminal.show();
    // show the command running in terminal for visibility
    terminal.sendText('git diff --name-only --diff-filter=U');

    // get the specific python functions that have conflicts inside them
    const conflictedFunctions = await getConflictedFunctions();

    if (Object.keys(conflictedFunctions).length === 0) {
        vscode.window.showInformationMessage('No merge conflicts detected in Python files.');
        return;
    }

    // mostly for debugging purposes
    vscode.window.showInformationMessage(
        `MC Hammer found conflicts in: ${Object.keys(conflictedFunctions).join(', ')}`
    );

    // kick off AI pipeline with conflictedFunctions -- need to send using WebSockets
    // dict format: { "src/foo.py": ["my_function"], "src/bar.py": ["other_function"] }
    // assuming backend is python rn so we're scoped to python functions only
}

// this is for putting in all commands in one singular terminal so everytime runApprovedCommand is called, it will reuse the same terminal if it exists
function getTerminal(): vscode.Terminal {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
}

function sendToBackend(data: string) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
    }else {
        socket.addEventListener('open', () => socket.send(data), {once: true});
    }
}

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
        vscode.commands.executeCommand(
            'simpleBrowser.show',
            'http://localhost:5173'
        );
    }, 4000);
}

// code for showInformationMessage() 
// notification of mc hammer wants to run command with buttons - pass in the command we want to run after approval
// returns if it ran, was rejected, or dismissed 
export async function runApprovedCommand(command: string, context: vscode.ExtensionContext): Promise<'ran' | 'rejected' | 'dismissed'> {
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
        }else {
            vscode.window.showInformationMessage('Failed');
        }
        return 'ran';
    }

    if (result === 'Reject') {
        return 'rejected';
    }

    // covers dismissing the modal (escape key or clicking outside)
    return 'dismissed';
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "mc-hammer" is now active!');

    // status bar item that appears when a merge conflict is detected in a python file
    // clicking it triggers the hammer pipeline
    const conflictStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    conflictStatusBar.text = '🔨 MC Hammer: Merge Conflict Detected';
    conflictStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground'); // red background
    conflictStatusBar.command = 'mc-hammer.buttonClicked'; // clicking triggers the pipeline
    conflictStatusBar.tooltip = 'Click to run MC Hammer on merge conflicts';
    conflictStatusBar.hide(); // hidden until a conflict is detected
    context.subscriptions.push(conflictStatusBar);

    // watch for merge conflicts appearing in python files automatically
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.py');
    watcher.onDidChange(async (uri) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.getText().includes('<<<<<<<')) {
            // show the status bar item so user knows a conflict was detected
            conflictStatusBar.show();
            vscode.window.showInformationMessage(
                `MC Hammer detected a merge conflict in ${uri.fsPath}`
            );
        } else {
            // hide it if conflicts are resolved
            conflictStatusBar.hide();
        }
    });
    context.subscriptions.push(watcher);

    const disposable = vscode.commands.registerCommand('mc-hammer.helloWorld', () => {
        vscode.window.showInformationMessage('Hello! from mc-hammer!');
    });

    // registers the hammer button in the editor title bar
	const hammerButton = vscode.commands.registerCommand('mc-hammer.buttonClicked', () => {
		buttonClicked().catch(err => {
			vscode.window.showErrorMessage(`MC Hammer error: ${err.message}`);
		});
	});

    context.subscriptions.push(disposable);
    context.subscriptions.push(hammerButton);
}

export function deactivate() {
    hammerTerminal?.dispose();
    reactTerminal?.dispose();
}