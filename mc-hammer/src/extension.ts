import * as vscode from 'vscode';
import * as cp from 'child_process';

// uses git diff to get list of conflicted python files, then scans each file
// for conflict markers and finds the enclosing python function
// returns a dict with key = file path, value = list of function names with conflicts
async function getConflictedFunctions(): Promise<Record<string, string[]>> {
    const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath!;
    const result: Record<string, string[]> = {};

    return new Promise((resolve) => {
        // git diff --name-only --diff-filter=U lists only files currently in a conflict state
        cp.exec('git diff --name-only --diff-filter=U', { cwd }, async (err, stdout) => {
            if (err || !stdout.trim()) {
                resolve(result);
                return;
            }

            // filter to only python files
            const conflictedFiles = stdout.trim().split('\n').filter(f => f.endsWith('.py'));

            for (const filePath of conflictedFiles) {
                const fullPath = `${cwd}/${filePath}`;
                const doc = await vscode.workspace.openTextDocument(fullPath);
                const lines = doc.getText().split('\n');
                const functions: string[] = [];

                // scan each line for conflict markers, then scan upward for enclosing def
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('<<<<<<<')) {
                        for (let j = i; j >= 0; j--) {
                            if (lines[j].trimStart().startsWith('def ')) {
                                const funcName = lines[j].trim().split('(')[0].replace('def ', '');
                                if (!functions.includes(funcName)) {
                                    functions.push(funcName);
                                }
                                break;
                            }
                        }
                    }
                }

                if (functions.length > 0) {
                    result[filePath] = functions;
                }
            }

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

let hammerTerminal: vscode.Terminal | undefined; // variable that holds a reference to the MC Hammer terminal

// this is for putting in all commands in one singular terminal so everytime runApprovedCommand is called, it will reuse the same terminal if it exists
function getTerminal(): vscode.Terminal {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
}

// notification of mc hammer wants to run command with buttons - pass in the command we want to run after approval
// returns if it ran, was rejected, or dismissed
export async function runApprovedCommand(command: string): Promise<'ran' | 'rejected' | 'dismissed'> {
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
        buttonClicked();
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(hammerButton);
}

export function deactivate() {
    hammerTerminal?.dispose();
}