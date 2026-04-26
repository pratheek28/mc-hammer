import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket as UiCommandWebSocket } from 'ws';

let hammerTerminal: vscode.Terminal | undefined;
let reactTerminal: vscode.Terminal | undefined;
let uiCommandServer: http.Server | undefined;
let uiCommandSocketServer: WebSocketServer | undefined;
let reactStartupPanel: vscode.WebviewPanel | undefined;


const UI_COMMAND_PORT = 8766;
const DEFAULT_PYTHON_EXCLUDE_GLOB = '**/{.git,node_modules,.venv,venv,__pycache__,dist,build}/**';

interface FunctionLocation {
    filePath: string;
    line: number;
}

const functionLocationByLabel: Record<string, FunctionLocation> = {};
import { send } from 'process';
import { ConflictPetViewProvider } from './conflictPetView';

let conflictStatusBar: vscode.StatusBarItem | null = null;
let conflictPetViewProvider: ConflictPetViewProvider | null = null;
let latestTargetFunctionFile: string | null = null;

const socket: WebSocket = new WebSocket("ws://127.0.0.1:8765");

async function buttonClicked(context: vscode.ExtensionContext, conflictStatusBar: vscode.StatusBarItem | null, conflictPetViewProvider: ConflictPetViewProvider | null) {
    const terminal = getTerminal();
    terminal.show();
    terminal.sendText('Write-Host "git diff --name-only --diff-filter=U" -ForegroundColor Red; git diff --name-only --diff-filter=U');

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
    latestTargetFunctionFile = targetFunctionFile;

    if (!remote || !curr || !commit) {
        vscode.window.showErrorMessage('MC Hammer: Could not retrieve all required data. Aborting send.');
        return;
    }
    const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (dir) {
        runApprovedCommand(context, dir, JSON.stringify(conflictedFunctions), targetFunction[0], curr, remote, commit); 
    }else {
        vscode.window.showErrorMessage('MC Hammer: Could not retrieve working directory. Aborting...');
        return;
    }
}

async function openFunctionLocation(location: FunctionLocation): Promise<void> {
    const document = await vscode.workspace.openTextDocument(location.filePath);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const targetPosition = new vscode.Position(Math.max(0, location.line - 1), 0);
    editor.selection = new vscode.Selection(targetPosition, targetPosition);
    editor.revealRange(new vscode.Range(targetPosition, targetPosition), vscode.TextEditorRevealType.InCenter);
}

async function buildFunctionLocationDictionary(): Promise<void> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
        return;
    }

    for (const key of Object.keys(functionLocationByLabel)) {
        delete functionLocationByLabel[key];
    }

    const pythonFiles = await vscode.workspace.findFiles('**/*.py', DEFAULT_PYTHON_EXCLUDE_GLOB);
    const functionPattern = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

    for (const fileUri of pythonFiles) {
        const document = await vscode.workspace.openTextDocument(fileUri);
        const lines = document.getText().split('\n');

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(functionPattern);
            if (!match) {
                continue;
            }

            const functionLabel = match[1];
            if (!functionLocationByLabel[functionLabel]) {
                functionLocationByLabel[functionLabel] = {
                    filePath: fileUri.fsPath,
                    line: i + 1
                };
            }
        }
    }
}

function startUiCommandServer(context: vscode.ExtensionContext): void {
    if (uiCommandServer) {
        return;
    }

    uiCommandServer = http.createServer((req, res) => {
        const requestUrl = req.url ? new URL(req.url, `http://127.0.0.1:${UI_COMMAND_PORT}`) : null;
        if (!requestUrl || req.method !== 'GET') {
            res.statusCode = 404;
            res.end('Not found');
            return;
        }

        if (requestUrl.pathname === '/question-context' || requestUrl.pathname === '/open-function') {
            res.statusCode = 426;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Use WebSocket endpoint ws://127.0.0.1:8766/ui-commands' }));
            return;
        }

        if (requestUrl.pathname !== '/open-function') {
            res.statusCode = 404;
            res.end('Not found');
            return;
        }

        const rawLabel = requestUrl.searchParams.get('label');
        const label = rawLabel?.trim();

        if (!label) {
            res.statusCode = 400;
            res.end('Missing label');
            return;
        }

        const location = functionLocationByLabel[label];
        if (!location) {
            res.statusCode = 404;
            res.end('Function label not found');
            return;
        }

        openFunctionLocation(location).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`MC Hammer: Unable to open function "${label}": ${message}`);
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
    });

    uiCommandSocketServer = new WebSocketServer({ server: uiCommandServer, path: '/ui-commands' });
    uiCommandSocketServer.on('connection', (client: UiCommandWebSocket) => {
        client.on('message', async (rawMessage) => {
            let parsedMessage: unknown;
            try {
                parsedMessage = JSON.parse(rawMessage.toString());
            } catch {
                client.send(JSON.stringify({ ok: false, type: 'error', error: 'Invalid JSON message.' }));
                return;
            }

            const command = typeof parsedMessage === 'object' && parsedMessage !== null
                ? parsedMessage as Record<string, unknown>
                : null;
            const type = typeof command?.type === 'string' ? command.type : '';

            if (type === 'question-context') {
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspacePath || !latestTargetFunctionFile) {
                    client.send(JSON.stringify({
                        ok: false,
                        type: 'question-context',
                        error: 'No target file context available yet.'
                    }));
                    return;
                }

                try {
                    const [remote, curr] = await Promise.all([
                        getRemoteFileContent(workspacePath, latestTargetFunctionFile),
                        getCurrentFileContent(workspacePath, latestTargetFunctionFile),
                    ]);
                    client.send(JSON.stringify({ ok: true, type: 'question-context', remote, curr }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    client.send(JSON.stringify({ ok: false, type: 'question-context', error: message }));
                }
                return;
            }

            if (type === 'open-function') {
                const label = typeof command?.label === 'string' ? command.label.trim() : '';
                if (!label) {
                    client.send(JSON.stringify({ ok: false, type: 'open-function', error: 'Missing label' }));
                    return;
                }

                const location = functionLocationByLabel[label];
                if (!location) {
                    client.send(JSON.stringify({ ok: false, type: 'open-function', error: 'Function label not found' }));
                    return;
                }

                try {
                    await openFunctionLocation(location);
                    client.send(JSON.stringify({ ok: true, type: 'open-function' }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    client.send(JSON.stringify({ ok: false, type: 'open-function', error: message }));
                    vscode.window.showErrorMessage(`MC Hammer: Unable to open function "${label}": ${message}`);
                }
                return;
            }

            client.send(JSON.stringify({ ok: false, type: 'error', error: 'Unsupported command type.' }));
        });
    });

    uiCommandServer.listen(UI_COMMAND_PORT, '127.0.0.1', () => {
        console.log(`[MC Hammer] UI command server listening on ${UI_COMMAND_PORT}`);
    });

    context.subscriptions.push({
        dispose: () => {
            if (uiCommandSocketServer) {
                uiCommandSocketServer.close();
                uiCommandSocketServer = undefined;
            }
            if (uiCommandServer) {
                uiCommandServer.close();
                uiCommandServer = undefined;
            }
        }
    });
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
        hammerTerminal = vscode.window.createTerminal({
            name: 'MC Hammer',
            color: new vscode.ThemeColor('terminal.ansiRed')
        });    }
    return hammerTerminal;
}

let tpwd="";
let tconflictedFunctions="";
let ttargetFunction="";
let tcurr="";
let tremote="";
let tcommit="";
let latestGeneratedTestCases: GeneratedTestCase[] | null = null;

interface GeneratedTestCase {
    filename: string;
    functionName: string;
    testName: string;
    setup: string;
    call: string;
    expected_return: string;
    expected_side_effects: string;
    description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isGeneratedTestCase(value: unknown): value is GeneratedTestCase {
    if (!isRecord(value)) {
        return false;
    }

    const requiredFields: Array<keyof GeneratedTestCase> = [
        'filename',
        'functionName',
        'testName',
        'setup',
        'call',
        'expected_return',
        'expected_side_effects',
        'description'
    ];

    return requiredFields.every((field) => typeof value[field] === 'string');
}

function flattenTestCaseCandidates(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        return [value];
    }

    const flattened: unknown[] = [];
    for (const item of value) {
        flattened.push(...flattenTestCaseCandidates(item));
    }
    return flattened;
}

function parseTestCasesPayload(rawPayload: unknown): GeneratedTestCase[] | null {
    let payload: unknown = rawPayload;

    if (typeof rawPayload === 'string') {
        const trimmed = rawPayload.trim();
        if (!trimmed) {
            return null;
        }

        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                payload = JSON.parse(trimmed);
            } catch {
                return null;
            }
        } else {
            return null;
        }
    }

    if (Array.isArray(payload)) {
        const flattened = flattenTestCaseCandidates(payload);
        const validCases = flattened.filter(isGeneratedTestCase);
        return validCases.length > 0 ? validCases : null;
    }

    if (!isRecord(payload)) {
        return null;
    }

    const arrayCandidate =
        payload.testcases ??
        payload.testCases ??
        payload.test_cases ??
        payload.cases ??
        payload.payload;

    if (!Array.isArray(arrayCandidate)) {
        return null;
    }

    const flattened = flattenTestCaseCandidates(arrayCandidate);
    const validCases = flattened.filter(isGeneratedTestCase);
    return validCases.length > 0 ? validCases : null;
}

function parseJsonIfPossible(rawPayload: unknown): unknown {
    if (typeof rawPayload !== 'string') {
        return rawPayload;
    }

    const trimmed = rawPayload.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
        return rawPayload;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return rawPayload;
    }
}

function getModuleName(filename: string): string {
    const normalized = filename.replace(/\\/g, '/');
    const withoutExtension = normalized.endsWith('.py') ? normalized.slice(0, -3) : normalized;
    const basename = withoutExtension.split('/').pop() ?? withoutExtension;
    return basename.trim();
}

function toPythonIdentifier(value: string): string {
    const normalized = value.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z_]+/, '');
    return normalized || 'generated_test';
}

function indentPythonBlock(text: string, level = 1): string {
    const indent = '    '.repeat(level);
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    return lines.map((line) => (line.trim() ? `${indent}${line}` : '')).join('\n');
}

function buildCallSnippet(call: string): string {
    const trimmed = call.trim();
    if (!trimmed) {
        return 'result = None';
    }

    const normalizedLines = call.replace(/\r\n/g, '\n').split('\n');
    const hasResultAssignment = normalizedLines.some((line) => line.trimStart().startsWith('result'));
    if (hasResultAssignment) {
        return normalizedLines.join('\n');
    }

    if (normalizedLines.length === 1) {
        return `result = ${normalizedLines[0]}`;
    }

    return ['_mc_hammer_call = (', ...normalizedLines, ')', 'result = _mc_hammer_call'].join('\n');
}

function buildPythonTestRunner(testCases: GeneratedTestCase[]): string {
    const importLines = [...new Set(testCases.map((testCase) => {
        const moduleName = getModuleName(testCase.filename);
        return `from ${moduleName} import ${testCase.functionName}`;
    }))].sort();

    const testFunctions = testCases.map((testCase) => {
        const functionName = toPythonIdentifier(testCase.testName);
        const setupBlock = indentPythonBlock(testCase.setup, 1);
        const callBlock = indentPythonBlock(buildCallSnippet(testCase.call), 1);
        const expectedLine = `    expected = ${testCase.expected_return}`;
        const returnLine = `    return ${JSON.stringify(testCase.testName)}, result, expected`;

        return [
            `def ${functionName}():`,
            setupBlock,
            callBlock,
            expectedLine,
            returnLine
        ].join('\n');
    });

    const mainLines = [
        'def main():',
        '    tests = ['
    ];

    for (const testCase of testCases) {
        mainLines.push(`        (${JSON.stringify(testCase.functionName)}, ${toPythonIdentifier(testCase.testName)}),`);
    }

    mainLines.push(
        '    ]',
        '',
        '    for function_name, test in tests:',
        '        test_name, actual, expected = test()',
        '        if actual == expected:',
        '            print(f"{function_name},{test_name}, SUCCESS")',
        '        else:',
        '            print(f"{function_name},{test_name}, FAIL (expected={expected!r}, actual={actual!r})")',
        '',
        "if __name__ == '__main__':",
        '    main()'
    );

    return [
        '# Auto-generated by MC Hammer',
        ...importLines,
        '',
        ...testFunctions.flatMap((fnBody) => [fnBody, '']),
        ...mainLines
    ].join('\n');
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

function getStartupGifHtml(webview: vscode.Webview, gifUri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #111;
        }
        img {
            width: min(80vw, 540px);
            height: auto;
            object-fit: contain;
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <img src="${gifUri}" alt="MC Hammer warming up..." />
</body>
</html>`;
}

function startReactAndPreview(context: vscode.ExtensionContext, _conflictPetViewProvider?: ConflictPetViewProvider | null): void {
    if (reactStartupPanel) {
        reactStartupPanel.dispose();
        reactStartupPanel = undefined;
    }

    reactStartupPanel = vscode.window.createWebviewPanel(
        'mcHammerReactStartup',
        'MC Hammer',
        vscode.ViewColumn.Beside,
        {
            enableScripts: false,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
        }
    );

    const fightGifUri = reactStartupPanel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', 'fight.gif')
    );
    reactStartupPanel.webview.html = getStartupGifHtml(reactStartupPanel.webview, fightGifUri);
    reactStartupPanel.onDidDispose(() => {
        reactStartupPanel = undefined;
    });

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
        reactStartupPanel?.dispose();
        reactStartupPanel = undefined;
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
        await buildFunctionLocationDictionary();

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
            buttonClicked(context, conflictStatusBar, conflictPetViewProvider).catch(err => {
                vscode.window.showErrorMessage(`MC Hammer error: ${err.message}`);
            });
        })
    );

    const buildTestRunnerButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        99
    );
    buildTestRunnerButton.text = '$(beaker) MC Hammer: Build Tests';
    buildTestRunnerButton.command = 'mc-hammer.buildTestCaseRunner';
    buildTestRunnerButton.tooltip = 'Generate temporary Python testcase runner from latest backend testcase payload';
    buildTestRunnerButton.show();
    context.subscriptions.push(buildTestRunnerButton);

    const testRunnerBuilderCommand = vscode.commands.registerCommand('mc-hammer.buildTestCaseRunner', async () => {
        if (!latestGeneratedTestCases || latestGeneratedTestCases.length === 0) {
            vscode.window.showWarningMessage('No testcase payload received yet. Run MC Hammer generation first.');
            return;
        }

        await testCases(latestGeneratedTestCases);
    });
    context.subscriptions.push(testRunnerBuilderCommand);
    startUiCommandServer(context);

	//listen for messages from the backend 
	socket.addEventListener('message', (event) => {
		const parsedMessage = parseJsonIfPossible(event.data);
		const wrappedPayload = isRecord(parsedMessage) && parsedMessage.type === 'generated_testcases'
            ? parsedMessage.payload
            : parsedMessage;

		const testCasePayload = parseTestCasesPayload(wrappedPayload);
		if (testCasePayload) {
            latestGeneratedTestCases = testCasePayload;
			testCases(testCasePayload).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`MC Hammer testcase runner error: ${message}`);
			});
			return;
		}

		// const command = typeof event.data === 'string' ? event.data : String(event.data);
		// runApprovedCommand(command, context);
	});
}

export async function testCases(rawPayload: unknown): Promise<void> {
    const parsedTestCases = parseTestCasesPayload(rawPayload);
    if (!parsedTestCases || parsedTestCases.length === 0) {
        vscode.window.showErrorMessage('MC Hammer: Invalid testcase payload received from backend.');
        return;
    }

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
        vscode.window.showErrorMessage('MC Hammer: No workspace folder found for testcase generation.');
        return;
    }

    const generatedFileName = `mc_hammer_temp_tests_${Date.now()}.py`;
    const outputPath = path.join(workspacePath, generatedFileName);
    const fileContent = buildPythonTestRunner(parsedTestCases);

    try {
        await fs.writeFile(outputPath, fileContent, 'utf8');
        const doc = await vscode.workspace.openTextDocument(outputPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(`MC Hammer generated testcase runner: ${generatedFileName}`);

        const terminal = getTerminal();
        terminal.show();
        terminal.sendText(`cd ${quoteForShell(workspacePath)}`);
        terminal.sendText(`python3 ${quoteForShell(outputPath)} || python ${quoteForShell(outputPath)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`MC Hammer failed to generate testcase runner: ${message}`);
    }
}

export function deactivate() {
    hammerTerminal?.dispose();
    reactTerminal?.dispose();
}