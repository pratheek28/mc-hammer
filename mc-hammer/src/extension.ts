import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import { send } from 'process';
import { ConflictPetViewProvider } from './conflictPetView';

let hammerTerminal: vscode.Terminal | undefined;
let reactTerminal: vscode.Terminal | undefined;
let conflictStatusBar: vscode.StatusBarItem | null = null;
let conflictPetViewProvider: ConflictPetViewProvider | null = null;

const socket: WebSocket = new WebSocket("ws://127.0.0.1:8765");

async function buttonClicked(conflictStatusBar: vscode.StatusBarItem | null, conflictPetViewProvider: ConflictPetViewProvider | null) {
    const terminal = getTerminal();
    terminal.show();
    terminal.sendText('git diff --name-only --diff-filter=U');

    const conflictedFunctions = await getConflictedFunctions();

    if (Object.keys(conflictedFunctions).length === 0) {
		if (conflictStatusBar) {
			conflictStatusBar.color = new vscode.ThemeColor('statusBar.debuggingForeground');
			conflictStatusBar.text = '$(check) 🔨 No Merge Conflicts';
			conflictStatusBar.backgroundColor = undefined;
		}
        vscode.window.showInformationMessage('No merge conflicts detected in Python files.');
		if (conflictPetViewProvider) {conflictPetViewProvider.setConflictState(false);}
        return;
    }

	if (conflictStatusBar) {
		conflictStatusBar.text = '$(warning) 🔨 Merge Conflict Detected';
		conflictStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
	}
	if (conflictPetViewProvider) {conflictPetViewProvider.setConflictState(true);}

    vscode.window.showInformationMessage(
        `MC Hammer found conflicts in: ${Object.keys(conflictedFunctions).join(', ')}`
    );

    const targetFunctionFile = Object.keys(conflictedFunctions)[0] ?? "";
    const targetFunction = conflictedFunctions[targetFunctionFile];
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!targetFunctionFile || !workspacePath) {
        vscode.window.showErrorMessage('MC Hammer: Could not determine target function or workspace path.');
        return;
    }

    const [remote, curr, commit] = await Promise.all([
        getRemoteFileContent(workspacePath, targetFunctionFile),
        getCurrentFileContent(workspacePath, targetFunctionFile),
        getLatestMainCommitMessage(workspacePath)
    ]);

    if (!remote || !curr || !commit) {
        vscode.window.showErrorMessage('MC Hammer: Could not retrieve all required data. Aborting send.');
        return;
    }
    const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (dir) {
        // runApprovedCommand(context, dir, JSON.stringify(conflictedFunctions), targetFunction[0], curr, remote, commit); 
    }else {
        vscode.window.showErrorMessage('MC Hammer: Could not retrieve working directory. Aborting...');
        return;
    }
}

function execInWorkspace(command: string, cwd: string): Promise<string> {
    return new Promise((resolve) => {
        cp.exec(command, { cwd }, (err, stdout) => {
            if (err) {
                resolve("");
                return;
            }
            resolve(stdout);
        });
    });
}

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function getRemoteFileContent(cwd: string, filePath: string): Promise<string> {
    const quotedPath = quoteForShell(filePath);
    const requestedCommand = `git show origin main:${quotedPath}`;
    const requestedOutput = await execInWorkspace(requestedCommand, cwd);
    if (requestedOutput.trim()) {
        return requestedOutput;
    }

    const canonicalCommand = `git show origin/main:${quotedPath}`;
    return execInWorkspace(canonicalCommand, cwd);
}

async function getCurrentFileContent(cwd: string, filePath: string): Promise<string> {
    const absolutePath = path.join(cwd, filePath);
    try {
        return await fs.readFile(absolutePath, 'utf8');
    } catch {
        return "";
    }
}

function getLatestMainCommitMessage(cwd: string): Promise<string> {
    return execInWorkspace('git log main -1 --pretty=%B', cwd);
}

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

function getTerminal(): vscode.Terminal {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
}

function sendToBackend(pwd: string, conflictedFunctions: string, targetFunction: string, curr: string, remote: string, commit: string) {
    const data = JSON.stringify({
        pwd,
        conflicted_functions: conflictedFunctions,
        target_function: targetFunction,
        curr,
        remote,
        commit,
        direct_only: true
    });

    if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
    } else {
        socket.addEventListener('open', () => socket.send(data), { once: true });
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

export async function runApprovedCommand(context: vscode.ExtensionContext, pwd: string, conflictedFunctions: string, targetFunction: string, curr: string, remote: string, commit: string): Promise<'ran' | 'rejected' | 'dismissed'> {
    const result = await vscode.window.showInformationMessage(
        `MC Hammer wants to work its magic}`,
        { modal: true },
        'Run it',
        'Reject'
    );

    if (result === 'Run it') {

        sendToBackend(pwd, conflictedFunctions, targetFunction, curr, remote, commit);
        startReactAndPreview(context);
        // const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        // if (dir) {
        //     vscode.env.clipboard.writeText(dir);
        //     vscode.window.showInformationMessage(`Copied dir: ${dir}`);
        //     sendToBackend(dir, "", "", "", "", "");
        //     vscode.window.showInformationMessage('Sent directory to backend!');
        //     startReactAndPreview(context);
        // } else {
        //     vscode.window.showInformationMessage('Failed');
        // }
        return 'ran';
    }

    if (result === 'Reject') {
        return 'rejected';
    }

    return 'dismissed';
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "mc-hammer" is now active!');

    conflictStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    conflictStatusBar.text = '$(check) 🔨 No Merge Conflicts';
    conflictStatusBar.backgroundColor = undefined;
    conflictStatusBar.command = 'mc-hammer.buttonClicked';
    conflictStatusBar.tooltip = 'Click to run MC Hammer on merge conflicts';
    conflictStatusBar.show();
    context.subscriptions.push(conflictStatusBar);

    conflictPetViewProvider = new ConflictPetViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ConflictPetViewProvider.viewType,
            conflictPetViewProvider,
        ),
    );
    conflictPetViewProvider.setConflictState(false);

    // VS Code Git API
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (gitExtension) {
        const git = gitExtension.getAPI(1);

        const attachToRepo = (repo: any) => {
            context.subscriptions.push(
                repo.state.onDidChange(() => {
                    const hasConflict = repo.state.mergeChanges.length > 0;

                    if (hasConflict) {
                        if (conflictStatusBar) {
                            conflictStatusBar.text = '$(warning) 🔨 Merge Conflict Detected';
                            conflictStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                        }
                        if (conflictPetViewProvider) { conflictPetViewProvider.setConflictState(true); }
                    } else {
                        if (conflictStatusBar) {
                            conflictStatusBar.text = '$(check) 🔨 No Merge Conflicts';
                            conflictStatusBar.backgroundColor = undefined;
                        }
                        if (conflictPetViewProvider) { conflictPetViewProvider.setConflictState(false); }
                    }
                })
            );
        };

        git.repositories.forEach(attachToRepo);
        context.subscriptions.push(git.onDidOpenRepository(attachToRepo));
    } else {
        vscode.window.showErrorMessage('MC Hammer: Git extension not available.');
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('mc-hammer.buttonClicked', () => {
            buttonClicked(conflictStatusBar, conflictPetViewProvider).catch(err => {
                vscode.window.showErrorMessage(`MC Hammer error: ${err.message}`);
            });
        })
    );
}

export function deactivate() {
    hammerTerminal?.dispose();
    reactTerminal?.dispose();
}