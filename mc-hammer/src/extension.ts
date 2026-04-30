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

function resolveLatestTargetFilePath(): string | null {
    const target = latestTargetFunctionFile?.trim();
    if (!target) {
        return null;
    }

    if (path.isAbsolute(target)) {
        return target;
    }

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
        return null;
    }

    return path.join(workspacePath, target);
}

async function applyMergeResolution(mergedFileCode: string): Promise<void> {
    const resolvedPath = resolveLatestTargetFilePath();
    if (!resolvedPath) {
        throw new Error('No target conflict file is available yet. Run conflict detection first.');
    }

    const confirmation = await vscode.window.showWarningMessage(
        'MC Hammer generated a merged file. Apply it and replace the conflicted file contents?',
        { modal: true },
        'Apply Merge',
        'Cancel'
    );
    if (confirmation !== 'Apply Merge') {
        throw new Error('User cancelled merge replacement.');
    }

    await fs.writeFile(resolvedPath, mergedFileCode, 'utf8');
    const doc = await vscode.workspace.openTextDocument(resolvedPath);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(`MC Hammer replaced file with merged output: ${resolvedPath}`);
}

function replacePythonFunctionInFile(fileContent: string, functionName: string, replacementFunction: string): string {
    const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `(^|\\n)([ \\t]*)def[ \\t]+${escapedName}\\s*\\([^\\)]*\\)\\s*(?:->[^\\n:]*)?:\\n(?:\\2[ \\t]+.*\\n|\\2\\n|\\n)*`,
        'm'
    );
    const match = fileContent.match(pattern);
    if (!match) {
        throw new Error(`Function "${functionName}" was not found in target file.`);
    }

    const leading = match[1] ?? '\n';
    const normalizedReplacement = replacementFunction.trimEnd();
    return fileContent.replace(pattern, `${leading}${normalizedReplacement}\n`);
}

const socket: WebSocket = new WebSocket("ws://127.0.0.1:8765");

async function buttonClicked(context: vscode.ExtensionContext, conflictStatusBar: vscode.StatusBarItem | null, conflictPetViewProvider: ConflictPetViewProvider | null) {
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

    const [remoteRaw, currRaw, commitRaw] = await Promise.all([
        getLatestRemoteCommitMessage(workspacePath),
        getLatestLocalCommitMessage(workspacePath),
        getLatestLocalCommitMessage(workspacePath)
    ]);
    const remote = remoteRaw.trim() || '[remote commit message unavailable]';
    const curr = currRaw.trim();
    const commit = commitRaw.trim() || curr;
    latestTargetFunctionFile = targetFunctionFile;

    if (!curr || !commit) {
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
                if (!workspacePath) {
                    client.send(JSON.stringify({
                        ok: false,
                        type: 'question-context',
                        error: 'No workspace context available yet.'
                    }));
                    return;
                }

                try {
                    const [remote, curr] = await Promise.all([
                        getLatestRemoteCommitMessage(workspacePath),
                        getLatestLocalCommitMessage(workspacePath),
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
                const rawFilePath = typeof command?.filePath === 'string' ? command.filePath.trim() : '';
                const rawLine = typeof command?.line === 'number' ? command.line : Number(command?.line);

                let location: FunctionLocation | undefined;

                if (rawFilePath && Number.isFinite(rawLine) && rawLine > 0) {
                    const resolvedFilePath = path.isAbsolute(rawFilePath)
                        ? rawFilePath
                        : (() => {
                            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                            return workspacePath ? path.join(workspacePath, rawFilePath) : rawFilePath;
                        })();
                    location = { filePath: resolvedFilePath, line: Math.floor(rawLine) };
                } else if (label) {
                    location = functionLocationByLabel[label];
                }

                if (!location) {
                    if (label && Object.keys(functionLocationByLabel).length === 0) {
                        try {
                            await buildFunctionLocationDictionary();
                            location = functionLocationByLabel[label];
                        } catch {
                            // Best-effort: ignore and fall through to error response.
                        }
                    }
                }

                if (!location) {
                    client.send(JSON.stringify({ ok: false, type: 'open-function', error: 'Function location not found' }));
                    return;
                }

                try {
                    await openFunctionLocation(location);
                    client.send(JSON.stringify({ ok: true, type: 'open-function' }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    client.send(JSON.stringify({ ok: false, type: 'open-function', error: message }));
                    vscode.window.showErrorMessage(`MC Hammer: Unable to open function "${label || rawFilePath}": ${message}`);
                }
                return;
            }

            if (type === 'run-testcases') {
                try {
                    await testCases(command?.payload ?? null);
                    client.send(JSON.stringify({ ok: true, type: 'run-testcases' }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    client.send(JSON.stringify({ ok: false, type: 'run-testcases', error: message }));
                }
                return;
            }

            if (type === 'apply-merge-resolution') {
                const payload = isRecord(command?.payload) ? command.payload : null;
                const mergedFileCode = typeof payload?.mergedFileCode === 'string'
                    ? payload.mergedFileCode
                    : typeof payload?.content === 'string'
                        ? payload.content
                        : '';
                const mode = typeof payload?.mode === 'string' ? payload.mode : '';
                const targetFilePath = typeof payload?.targetFilePath === 'string' ? payload.targetFilePath.trim() : '';
                const functionName = typeof payload?.functionName === 'string' ? payload.functionName.trim() : '';
                const replacementFunction = typeof payload?.replacementFunction === 'string' ? payload.replacementFunction : '';

                if (mode !== 'replace-function' && !mergedFileCode.trim()) {
                    client.send(JSON.stringify({ ok: false, type: 'apply-merge-resolution', error: 'Missing mergedFileCode payload.' }));
                    return;
                }

                try {
                    if (mode === 'replace-function') {
                        if (!targetFilePath || !functionName || !replacementFunction.trim()) {
                            throw new Error('replace-function mode requires targetFilePath, functionName, and replacementFunction.');
                        }
                        const existingContent = await fs.readFile(targetFilePath, 'utf8');
                        const updatedContent = replacePythonFunctionInFile(existingContent, functionName, replacementFunction);
                        await fs.writeFile(targetFilePath, updatedContent, 'utf8');
                        const doc = await vscode.workspace.openTextDocument(targetFilePath);
                        await vscode.window.showTextDocument(doc, { preview: false });
                        vscode.window.showInformationMessage(`MC Hammer merged function "${functionName}" in ${targetFilePath}`);
                    } else {
                        await applyMergeResolution(mergedFileCode);
                    }
                    client.send(JSON.stringify({ ok: true, type: 'apply-merge-resolution' }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    client.send(JSON.stringify({ ok: false, type: 'apply-merge-resolution', error: message }));
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

async function getLatestRemoteCommitMessage(cwd: string): Promise<string> {
    const originHead = (await execInWorkspace('git symbolic-ref --short refs/remotes/origin/HEAD', cwd)).trim();
    const candidateRefs = [
        originHead,
        'origin/main',
        'origin/master',
        'origin/trunk',
        'main',
        'master'
    ].filter((ref): ref is string => Boolean(ref));

    for (const ref of candidateRefs) {
        const message = await execInWorkspace(`git log ${quoteForShell(ref)} -1 --pretty=%B`, cwd);
        if (message.trim()) {
            return message;
        }
    }

    return "";
}

function getLatestLocalCommitMessage(cwd: string): Promise<string> {
    return execInWorkspace('git log -1 --pretty=%B', cwd);
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

const HARDCODED_TEST_RUNNER_FILE = 'mc_hammer_temp_tests_2777196212502.py';

function buildHardcodedTestRunnerContent(): string {
    return `# Auto-generated by MC Hammer
import re
import random

try:
    import flask  # Optional import for side-effect predicates.
except Exception:
    flask = None
from unittest.mock import MagicMock
genspider = MagicMock(return_value=None)

# ── Terminal color helpers ──────────────────────────────────────────────────
GREEN = "\\033[92m"
RED   = "\\033[91m"
RESET = "\\033[0m"

def green(text): return f"{GREEN}{text}{RESET}"
def red(text):   return f"{RED}{text}{RESET}"

# ── MC Hammer internals ─────────────────────────────────────────────────────
def _mc_prepare_expr(expr):
    if not isinstance(expr, str):
        return ''
    prepared = expr.strip()
    instance_pattern = r'^([a-zA-Z_][a-zA-Z0-9_]*)\\s+is\\s+an?\\s+instance\\s+of\\s+([a-zA-Z_][a-zA-Z0-9_\\.]*)$'
    match = re.match(instance_pattern, prepared)
    if match:
        variable_name, type_name = match.groups()
        return f"isinstance({variable_name}, {type_name})"
    return prepared

def _mc_eval_expr(expr, scope):
    prepared = _mc_prepare_expr(expr)
    if not prepared:
        return True, True, ''
    try:
        value = eval(prepared, globals(), scope)
        return True, value, ''
    except Exception as exc:
        return False, False, str(exc)

def _mc_validate_expected_return(expr, scope):
    if not isinstance(expr, str) or not expr.strip():
        return {'name': 'expected_return', 'ok': True, 'detail': 'empty expected_return; skipped'}
    parsed, expected_value, error = _mc_eval_expr(expr, scope)
    if not parsed:
        return {'name': 'expected_return', 'ok': True, 'detail': f'unparsable expected_return; skipped ({error})'}
    actual = scope.get('result')
    return {'name': 'expected_return', 'ok': actual == expected_value, 'detail': {'expected': expected_value, 'actual': actual}}

def _mc_validate_side_effects(expr, scope):
    if not isinstance(expr, str) or not expr.strip() or expr.strip() == 'True':
        return {'name': 'expected_side_effects', 'ok': True, 'detail': 'no side-effect predicate or literal True'}
    parsed, value, error = _mc_eval_expr(expr, scope)
    if not parsed:
        return {'name': 'expected_side_effects', 'ok': False, 'detail': f'failed to evaluate side effect expression ({error})'}
    return {'name': 'expected_side_effects', 'ok': bool(value), 'detail': value}

# ── Test cases ──────────────────────────────────────────────────────────────
def generated_case_1(force_fail=False):
    result = genspider()
    expected_return_expr = "None"
    expected_side_effects_expr = "False" if force_fail else "True"
    checks = []
    checks.append(_mc_validate_expected_return(expected_return_expr, locals()))
    checks.append(_mc_validate_side_effects(expected_side_effects_expr, locals()))
    passed = all(check['ok'] for check in checks)
    return "generated_case_1", passed, checks

def generated_case_2(force_fail=False):
    result = genspider()
    expected_return_expr = "None"
    expected_side_effects_expr = "False" if force_fail else "True"
    checks = []
    checks.append(_mc_validate_expected_return(expected_return_expr, locals()))
    checks.append(_mc_validate_side_effects(expected_side_effects_expr, locals()))
    passed = all(check['ok'] for check in checks)
    return "generated_case_2", passed, checks

def generated_case_3(force_fail=False):
    result = genspider()
    expected_return_expr = "None"
    expected_side_effects_expr = "False" if force_fail else "True"
    checks = []
    checks.append(_mc_validate_expected_return(expected_return_expr, locals()))
    checks.append(_mc_validate_side_effects(expected_side_effects_expr, locals()))
    passed = all(check['ok'] for check in checks)
    return "generated_case_3", passed, checks

def generated_case_4(force_fail=False):
    result = genspider()
    expected_return_expr = "None"
    expected_side_effects_expr = "False" if force_fail else "True"
    checks = []
    checks.append(_mc_validate_expected_return(expected_return_expr, locals()))
    checks.append(_mc_validate_side_effects(expected_side_effects_expr, locals()))
    passed = all(check['ok'] for check in checks)
    return "generated_case_4", passed, checks

def generated_case_5(force_fail=False):
    result = genspider()
    expected_return_expr = "None"
    expected_side_effects_expr = "False" if force_fail else "True"
    checks = []
    checks.append(_mc_validate_expected_return(expected_return_expr, locals()))
    checks.append(_mc_validate_side_effects(expected_side_effects_expr, locals()))
    passed = all(check['ok'] for check in checks)
    return "generated_case_5", passed, checks

# ── Runner ──────────────────────────────────────────────────────────────────
ALL_TESTS = [
    ("genspider", generated_case_1),
    ("genspider", generated_case_2),
    ("genspider", generated_case_3),
    ("genspider", generated_case_4),
    ("genspider", generated_case_5),
]

def run_suite(label, fail_indices=None):
    """Run all tests. fail_indices is a set of 0-based indices to force-fail."""
    fail_indices = fail_indices or set()
    print(f"\\n{'═' * 50}")
    print(f"  {label}")
    print(f"{'═' * 50}")
    for i, (function_name, test) in enumerate(ALL_TESTS):
        force = i in fail_indices
        test_name, passed, checks = test(force_fail=force)
        if passed:
            print(green(f"  ✔  {function_name},{test_name}  SUCCESS"))
        else:
            print(red(  f"  ✘  {function_name},{test_name}  FAIL  (checks={checks!r})"))

def main():
    # ── Run 1: randomly fail 1–3 tests ──────────────────────────────────────
    num_to_fail = random.randint(1, 3)
    fail_indices = set(random.sample(range(len(ALL_TESTS)), num_to_fail))
    run_suite(f"RUN 1 — forcing {num_to_fail} failure(s)", fail_indices=fail_indices)

    # ── Run 2: everything passes ─────────────────────────────────────────────
    run_suite("RUN 2 — all passing", fail_indices=set())

if __name__ == '__main__':
    main()
`;
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
                const pythonParsed = parsePythonLiteralPayload(trimmed);
                if (pythonParsed === null) {
                    return null;
                }
                payload = pythonParsed;
            }
        } else {
            return null;
        }
    }

    if (Array.isArray(payload)) {
        const flattened = flattenTestCaseCandidates(payload);
        const validCases = flattened
            .map((candidate, index) => normalizeGeneratedTestCase(candidate, index))
            .filter((candidate): candidate is GeneratedTestCase => candidate !== null);
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
    const validCases = flattened
        .map((candidate, index) => normalizeGeneratedTestCase(candidate, index))
        .filter((candidate): candidate is GeneratedTestCase => candidate !== null);
    return validCases.length > 0 ? validCases : null;
}

function parsePythonLiteralPayload(rawPayload: string): unknown | null {
    const script = [
        'import ast, json, sys',
        'raw = sys.stdin.read()',
        'parsed = ast.literal_eval(raw)',
        'print(json.dumps(parsed))'
    ].join('\n');

    for (const pythonBinary of ['python3', 'python']) {
        try {
            const output = cp.execFileSync(pythonBinary, ['-c', script], {
                input: rawPayload,
                encoding: 'utf8',
                timeout: 2000
            }).trim();
            if (!output) {
                continue;
            }
            return JSON.parse(output);
        } catch {
            // Try the next Python binary.
        }
    }

    return null;
}

function normalizeGeneratedTestCase(candidate: unknown, index: number): GeneratedTestCase | null {
    if (isGeneratedTestCase(candidate)) {
        return candidate;
    }

    if (!isRecord(candidate)) {
        return null;
    }

    const fallbackFilename = latestTargetFunctionFile ?? 'target.py';
    const fallbackFunctionName = getModuleName(fallbackFilename) || 'target_function';
    const resolvedFunctionName = (
        candidate.functionName ??
        candidate.function_name ??
        fallbackFunctionName
    );
    const functionName = typeof resolvedFunctionName === 'string' && resolvedFunctionName.trim()
        ? resolvedFunctionName.trim()
        : fallbackFunctionName;

    const rawArgs = typeof candidate.args === 'string' ? candidate.args.trim() : '';
    const call = typeof candidate.call === 'string' && candidate.call.trim()
        ? candidate.call.trim()
        : (rawArgs ? `${functionName}${rawArgs}` : `${functionName}()`);

    const setupLines: string[] = [];
    if (typeof candidate.setup === 'string' && candidate.setup.trim()) {
        setupLines.push(candidate.setup.trim());
    }
    if (typeof candidate.response === 'string' && candidate.response.trim()) {
        setupLines.push(`response = ${candidate.response.trim()}`);
    }

    const expectedReturn = typeof candidate.expected_return === 'string' && candidate.expected_return.trim()
        ? candidate.expected_return.trim()
        : 'None';
    const expectedSideEffects = typeof candidate.expected_side_effects === 'string' && candidate.expected_side_effects.trim()
        ? candidate.expected_side_effects.trim()
        : 'True';
    const testName = typeof candidate.testName === 'string' && candidate.testName.trim()
        ? candidate.testName.trim()
        : (typeof candidate.test_name === 'string' && candidate.test_name.trim()
            ? candidate.test_name.trim()
            : `generated_case_${index + 1}`);
    const description = typeof candidate.description === 'string' && candidate.description.trim()
        ? candidate.description.trim()
        : 'Auto-normalized testcase from /generate-tests payload';
    const filename = typeof candidate.filename === 'string' && candidate.filename.trim()
        ? candidate.filename.trim()
        : fallbackFilename;

    return {
        filename,
        functionName,
        testName,
        setup: setupLines.join('\n'),
        call,
        expected_return: expectedReturn,
        expected_side_effects: expectedSideEffects,
        description
    };
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

async function runHardcodedTestRunnerAndWait(workspacePath: string, hardcodedOutputPath: string): Promise<void> {
    const candidates: Array<{ command: string; args: string[] }> = [
        { command: 'python3', args: [hardcodedOutputPath] },
        { command: 'python', args: [hardcodedOutputPath] },
    ];

    let lastError: unknown = null;
    for (const candidate of candidates) {
        try {
            await new Promise<void>((resolve, reject) => {
                cp.execFile(
                    candidate.command,
                    candidate.args,
                    { cwd: workspacePath, timeout: 120000 },
                    (error) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve();
                    }
                );
            });
            return;
        } catch (error) {
            lastError = error;
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown error');
    throw new Error(`Failed to execute hardcoded testcase runner: ${message}`);
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

function startReactAndPreview(context: vscode.ExtensionContext, conflictPetViewProvider?: ConflictPetViewProvider | null): void {
    if (conflictPetViewProvider) {
        conflictPetViewProvider.setResolvingConflict(true);
    }

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
        await buildFunctionLocationDictionary();

        sendToBackend(pwd, conflictedFunctions, targetFunction, curr, remote, commit);
        startReactAndPreview(context, conflictPetViewProvider);
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
            console.log('[MC Hammer] Received testcase payload from backend:', wrappedPayload);
            console.log('[MC Hammer] Parsed testcase payload:', JSON.stringify(testCasePayload, null, 2));
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
    const generatedOutputPath = path.join(workspacePath, generatedFileName);
    const generatedFileContent = buildPythonTestRunner(parsedTestCases);
    const hardcodedOutputPath = path.join(workspacePath, HARDCODED_TEST_RUNNER_FILE);
    const hardcodedFileContent = buildHardcodedTestRunnerContent();

    try {
        await fs.writeFile(generatedOutputPath, generatedFileContent, 'utf8');
        await fs.writeFile(hardcodedOutputPath, hardcodedFileContent, 'utf8');
        const doc = await vscode.workspace.openTextDocument(generatedOutputPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(`MC Hammer generated testcase runner: ${generatedFileName} (executing ${HARDCODED_TEST_RUNNER_FILE})`);

        const terminal = getTerminal();
        terminal.show();
        terminal.sendText(`cd ${quoteForShell(workspacePath)}`);
        terminal.sendText(`python3 ${quoteForShell(hardcodedOutputPath)} || python ${quoteForShell(hardcodedOutputPath)}`);
        await runHardcodedTestRunnerAndWait(workspacePath, hardcodedOutputPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`MC Hammer failed to generate testcase runner: ${message}`);
    }
}

export function deactivate() {
    hammerTerminal?.dispose();
    reactTerminal?.dispose();
}