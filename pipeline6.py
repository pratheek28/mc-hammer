import json
import asyncio

from ollama import chat
from websockets.legacy.server import serve

from prompts import Prompts

import requests
import concurrent.futures
import time

import networkx as nx


test_variations = [
    "Focus primarily on standard, expected inputs (The Happy Path).",
    "Focus intensely on extreme boundary conditions (maximum values, huge strings, max integers).",
    "Focus intensely on empty/null conditions (None, empty lists, empty strings, 0).",
    "Focus intensely on invalid data types (passing strings instead of ints, dictionaries instead of lists).",
    "Focus on malicious or highly unusual inputs (special unicode characters, negative numbers, extremely long inputs)."
]

def generate_tests(commit_msg: str, modifications, affected_files, intent, focus_area: str, temp: float = 0.5):
    print("lol")
    print(f"modifications: {modifications}")
    # modifications_text = modifications if isinstance(modifications, str) else "\n\n---\n\n".join(modifications or [])
    # affected_functions = [affected_files] if isinstance(affected_files, str) else (affected_files or [])

    if isinstance(modifications, str):
        modifications_text = modifications
    elif isinstance(modifications, list):
        parts = []
        for m in modifications:
            if isinstance(m, dict):
                parts.append(m.get('file_content', str(m)))
            else:
                parts.append(str(m))
        modifications_text = "\n\n---\n\n".join(parts)
    else:
        modifications_text = str(modifications)

    # Same fix for affected_files
    if isinstance(affected_files, str):
        affected_functions = [affected_files]
    elif isinstance(affected_files, list):
        affected_functions = []
        for f in affected_files:
            if isinstance(f, dict):
                affected_functions.append(f.get('function_content', str(f)))
            else:
                affected_functions.append(str(f))
    else:
        affected_functions = [str(affected_files)]

    tests = chat(
        model='deepseek-coder-v2:16b',
        format='json',   
        messages = [
            {
                'role': 'system',
                'content': f'''You are an expert software testing engine that writes Python unittest test cases.
        You will be given source code files and your job is to write REAL, RUNNABLE Python unittest test cases.

        CRITICAL INSTRUCTION FOR THIS BATCH:
        {focus_area}
        Make sure ALL of your generated test cases strictly revolve around this specific testing focus.''' +
        '''
        Rules:
        1. Read the code carefully and understand exactly what each function does.
        2. Make up realistic, concrete test inputs yourself - do NOT use placeholders.
        3. Trace through the code logic manually to determine the exact expected output.
        4. NEVER output or repeat the original source code.
        5. "expected_return" MUST be the final evaluated value (e.g. "404", "True", "[1, 2]"), NOT the function definition.
        6. Never include any fluff. Just straight up the names, setup code, the call function, and expected output.

        You MUST return ONLY a valid JSON array starting with [ and ending with ].
        Each element MUST have ALL of these exact keys:
        "filename", "functionName", "testName", "setup", "call", 
        "expected_return", "expected_side_effects", "description"

        DO NOT return a single JSON object. DO NOT return {{"expected_return": ...}}.
        DO NOT invent your own schema. Use EXACTLY the array format shown.

        Each test case in the array must follow this EXACT format (note the quotes):
        [
          {
            "filename": "<name of the file>",
            "functionName": "<name of the function>",
            "testName": "<descriptive snake_case name>",
            "setup": "<exact python code to set up variables>",
            "call": "<exact python code calling the function>",
            "expected_return": "<the exact literal return value of the function>",
            "expected_side_effects": "<python boolean expression evaluating side effects>",
            "description": "<short summary of the test case>"
          }
        ]'''
            },
            {
                'role': 'user',
                'content': f'''Generate 3 test case for the following code.

        DEVELOPER INTENT (commit message):
        {commit_msg}

        MODIFIED SOURCE CODE:
        {modifications_text}

        AFFECTED FUNCTION:
        {json.dumps(affected_functions, ensure_ascii=False)}

        Instructions:
        - Invent realistic parameter values yourself based on what the code expects.
        - Write expected_return as the exact string or value the function would return.
        - Write expected_side_effects as a Python boolean expression that would evaluate to True after the call.

        Return only the raw JSON array. Start your response with [ and end with ].'''
            }
        ],
        options={
            "temperature": temp,
            "num_ctx": 2048,
            "think": False
        }
    )
    
    print("requesting from deepseek")
    
   
    # 
    
    raw_output = tests.message.content if getattr(tests, "message", None) else ""
    if not raw_output:
        return []

    # print(f"[DEBUG] raw_output: {raw_output[:200]}")


    try:
        parsed = json.loads(raw_output)
    except (TypeError, ValueError):
        return []

    

    if isinstance(parsed, list):
        return parsed
    elif isinstance(parsed, dict):
        for v in parsed.values():
            if isinstance(v, list):
                return v
            if isinstance(v, str):
                try:
                    inner = json.loads(v)
                    if isinstance(inner, list):
                        return inner
                except (json.JSONDecodeError, TypeError):
                    pass
       
        return [parsed]
    return []


def gain_understanding_of_project_return_viable_solutions(graph, local, remote):
    print("Got here!")
    # print()
    response = chat(
        model="qwen3:8b",
        options={"think": False},
        messages=[
            {
                'role': 'system',
                'content': (
                    "You are an expert software engineer specializing in conflict resolution and codebase architecture. "
                    "Given a dependency graph of a project and two conflicting commit messages, you will:\n"
                    "1. Identify which files/modules are affected and how they relate to each other.\n"
                    "2. Infer the intent of each commit from its message.\n"
                    "3. Produce exactly 2 viable merge resolution strategies.\n\n"
                    "Each strategy must:\n"
                    "- Preserve the core intent of BOTH commits where possible.\n"
                    "- Respect dependency relationships shown in the graph.\n"
                    "- Be concrete and actionable (specify which changes to keep, drop, or reconcile).\n"
                    "- Not break existing functionality implied by the graph structure.\n\n"
                    "Respond ONLY with a valid JSON object — no markdown, no explanation, no preamble. Make sure that the title is not very technical, but the detail is concrete and specific."
                    "Use this exact schema:\n"
                    "{\n"
                    '  "solutions": [\n'
                    "    {\n"
                    '      "title": "<2-4 word label>",\n'
                    '      "detail": "<1-2 sentence concrete resolution strategy>"\n'
                    "    },\n"
                    "    {\n"
                    '      "title": "<2-4 word label>",\n'
                    '      "detail": "<1-2 sentence concrete resolution strategy>"\n'
                    "    }\n"
                    "  ]\n"
                    "}"
                )
            },
            {
                'role': 'user',
                'content': (
                    f"## Project Dependency Graph\n{graph}\n\n"
                    f"## Local Commit\n{local}\n\n"
                    f"## Remote Commit\n{remote}\n\n"
                    "Analyze the graph and both commits, then provide 2 viable resolution strategies."
                )
            }
        ]
    )

    raw = response.message.content if getattr(response, "message", None) else ""
    print(f"Raw response: {raw}")
    
    if not raw:
        return {"error": "Model returned an empty response."}

    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {"raw_response": raw}


def multithread(intent, target_job):
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        future_to_job = {}
        for i, variation in enumerate(test_variations):
            dynamic_temp = 0.4 + (i * 0.1)
            future = executor.submit(
                generate_tests,
                target_job['commit_msg'],
                target_job['modifications'],
                target_job['affected_files'],
                intent,
                variation,
                dynamic_temp
            )
            future_to_job[future] = variation

        for future in concurrent.futures.as_completed(future_to_job):
            variation_used = future_to_job[future]
            try:
                test_output = future.result()  
                results.extend(test_output)   
            except Exception as exc:
                print(f"[Error] Exception generated: {exc}")

    print(f"Total test cases collected: {len(results)}")
    print(results)
    return results


def validator(results, test_cases):
    validated_results = {}

    for key, value in results.items():
        terminal_output = value[0]
        initial_verdict = value[1]

        if initial_verdict == "Success":
            validated_results[key] = {
                "terminal_output": terminal_output,
                "verdict": "Success",
                "validator_reasoning": "Exact match — no revalidation needed"
            }
            continue

        test_case = next((t for t in test_cases if t.get("testName") == key), None)
        if test_case is None:
            validated_results[key] = {
                "terminal_output": terminal_output,
                "verdict": "Failure",
                "validator_reasoning": "Test case not found for revalidation"
            }
            continue

        expected_return = test_case.get("expected_return", "")
        expected_side_effects = test_case.get("expected_side_effects", "")
        description = test_case.get("description", "")
        function_name = test_case.get("functionName", "")

        revalidate = chat(
            model='qwen3:8b',
            messages=[
                {
                    'role': 'system',
                    'content': '''You are a strict but fair test output validator.

            Your job is to determine if a test case that failed an exact string match 
            should actually be considered a PASS based on semantic equivalence.

            Rules for what counts as a PASS:
            - The terminal output conveys the same meaning as the expected output, even if worded differently
            - The terminal output contains all the critical information the expected output requires
            - Minor differences in punctuation, capitalization, whitespace, or word order are acceptable
            - If the test was designed to trigger an error/exception, any error output that indicates 
              the same failure mode counts as a PASS
            - If the test expected a specific numeric value, the output must match exactly — no leniency
            - If the test expected a specific object state, the state must be correct — no leniency
            - When in doubt, lean toward FAIL — a false pass is worse than a false fail

            Rules for what counts as a FAIL:
            - The terminal output indicates a completely different outcome than expected
            - The terminal output is empty when output was expected
            - The terminal output shows an unrelated crash or exception
            - The terminal output has the right structure but wrong values (wrong numbers, wrong names)
            - The program did something fundamentally different from what the test intended

            You MUST return ONLY a valid JSON object. Nothing before {. Nothing after }.
            No thinking tags. No explanation outside the JSON.

            Format:
            {
              "verdict": "Pass" or "Fail",
              "confidence": "high", "medium", or "low",
              "reasoning": "one or two sentences explaining exactly why this is a pass or fail",
              "key_difference": "the most important difference between expected and actual, or null if passing",
              "semantic_match": true or false
            }'''
                },
                {
                    'role': 'user',
                    'content': f'''Revalidate this failed test case.

            TEST NAME: {key}
            FUNCTION BEING TESTED: {function_name}
            TEST DESCRIPTION: {description}

            EXPECTED OUTPUT:
            {expected_return}

            EXPECTED SIDE EFFECTS:
            {expected_side_effects}

            ACTUAL TERMINAL OUTPUT:
            {terminal_output}

            The exact string match failed. Determine if the actual output is semantically 
            equivalent to the expected output and should be considered a PASS, or if it 
            represents a genuine failure.

            Focus on: does the actual output achieve the same intent as the expected output?
            Return only the raw JSON object.'''
                }
            ]
        )

        try:
            raw = revalidate['message']['content']
            if '<think>' in raw:
                raw = raw[raw.rfind('</think>')+8:].strip()
            validation = json.loads(raw)
        except json.JSONDecodeError:
            cleaned = raw[raw.find('{'):raw.rfind('}')+1]
            try:
                validation = json.loads(cleaned)
            except:
                validation = {
                    "verdict": "Fail",
                    "confidence": "low",
                    "reasoning": "Validator could not parse response",
                    "key_difference": "Parse error",
                    "semantic_match": False
                }

        validated_results[key] = {
            "terminal_output": terminal_output,
            "verdict": validation.get("verdict", "Fail"),
            "confidence": validation.get("confidence", "low"),
            "validator_reasoning": validation.get("reasoning", ""),
            "key_difference": validation.get("key_difference", ""),
            "semantic_match": validation.get("semantic_match", False),
            "initially_failed_exact_match": True
        }

    return validated_results

async def merge(file_with_conflicts):
    merged = chat(
        model='deepseek-coder-v2:16b',
        options={"num_ctx": 8192},
        messages=[
            {
                'role': 'system',
                'content': '''You are an expert code merge engine. You resolve Git merge conflicts by analyzing code structure, logic, and intent.

        You will receive a file containing Git merge conflict markers:
        - <<<<<<< HEAD : marks the start of the current branch changes
        - ======= : separates the two conflicting versions
        - >>>>>>> branch-name : marks the end of the incoming branch changes

        Your job:
        1. Identify every conflict block marked by <<<<<<< ======= >>>>>>>
        2. Analyze the code structure of both sides — function signatures, logic flow, dependencies, variable usage
        3. The resolution must be a fully valid, complete file — no conflict markers remaining, no placeholders, no truncation

        Rules:
        - Never leave any <<<<<<< ======= >>>>>>> markers in your output
        - Never truncate the file — always return the complete file content
        - Never add new logic that wasn't present in either branch
        - Never remove logic that both branches agree on
        - Base your decisions purely on code structure and syntax — not assumptions about runtime behavior

        You MUST return ONLY a valid JSON object. No markdown, no explanation, no preamble. Start with { and end with }.

        Return format:
        {
          "conflict_blocks_found": <number of conflict blocks you identified>,
          "reasons": "<an array of the reasons behind every edit you made (NO MORE THAN 10 WORDS MAX PER REASON)>",
          "resolution_1": {
            "strategy": "one sentence describing your conservative merge approach",
            "resolved_file": "<complete file content with all conflicts resolved>"
          }
        }'''
            },
            {
                'role': 'user',
                'content': f'''Resolve all merge conflicts in the following file.

        FILE WITH CONFLICTS:
        {file_with_conflicts}


        Instructions:
        - Find every <<<<<<< ======= >>>>>>> block in the file above
        - For each conflict block, analyze what each side is trying to do based on the surrounding code structure
        - Resolution: resolve it to the best of your ability
        Return only the raw JSON object. Start with {{ and end with }}. Nothing else.'''
            }
        ]
    )

    raw_output = merged.message.content if getattr(merged, "message", None) else ""
    if not raw_output:
        return {"error": "Model returned an empty response."}
    print(raw_output)

    try:
        parsed = json.loads(raw_output)
    except (TypeError, ValueError):
        parsed = {"raw_response": raw_output}

    return parsed

def feedback_merge(previous_attempts, commit_msg_a, commit_msg_b, file_with_conflicts, context_files=None):

    context_text = "\n\n---\n\n".join(context_files) if context_files else "No additional context provided."

    feedback_text = ""
    for attempt_num, attempt_feedback in enumerate(previous_attempts, 1):
        feedback_text += f"\n=== ATTEMPT {attempt_num} FEEDBACK ===\n"

        for merged_file, validated_results in attempt_feedback.items():

            passed = [(k, v) for k, v in validated_results.items() if v['verdict'] in ("Success", "Pass")]
            failed = [(k, v) for k, v in validated_results.items() if v['verdict'] == "Fail"]

            feedback_text += f"\n  MERGED FILE CANDIDATE: {merged_file}\n"
            feedback_text += f"  Results: {len(passed)} passed, {len(failed)} failed\n"

            if passed:
                feedback_text += f"\n    PASSING ({len(passed)}):\n"
                for test_name, result in passed:
                    semantic_note = " (semantic pass)" if result.get("initially_failed_exact_match") else ""
                    feedback_text += f"      {test_name}{semantic_note}\n"

            if failed:
                feedback_text += f"\n    ✗ FAILING ({len(failed)}):\n"
                for test_name, result in failed:
                    feedback_text += f"\n      ✗ {test_name}\n"
                    feedback_text += f"        Terminal Output:  {result.get('terminal_output', 'N/A')}\n"
                    feedback_text += f"        Key Difference:  {result.get('key_difference', 'N/A')}\n"
                    feedback_text += f"        Validator Notes: {result.get('validator_reasoning', 'N/A')}\n"
                    if result.get('confidence') == 'low':
                        feedback_text += f"  Borderline case — low confidence\n"

            score = len(passed) / max(len(validated_results), 1) * 100
            feedback_text += f"\n  CANDIDATE SCORE: {score:.1f}% ({len(passed)}/{len(validated_results)} tests passing)\n"
            feedback_text += f"  {'BEST CANDIDATE SO FAR' if score == 100 else 'NEEDS IMPROVEMENT'}\n"

    learn = chat(
        model='deepseek-coder-v2:16b',
        messages=[
            {
                'role': 'system',
                'content': '''You are an expert code merge engine on your retry loop. Your previous merge resolutions were tested and some tests failed.

        You will receive:
        1. The original file with merge conflicts
        2. Detailed feedback on every test that passed and failed on your previous attempts
        3. The exact error messages and mismatched values from each failure

        Your job:
        1. Read every failed test carefully — the expected value and actual value tell you exactly what your previous resolution got wrong
        2. Identify which specific lines or logic in your previous resolution caused each failure
        3. Generate 2 new resolutions that directly fix every failing test while keeping all passing tests green
        4. Do NOT repeat the same mistake from your previous attempts
        5. Do NOT blindly favor one branch — synthesize both based on what the tests are telling you is correct behavior

        Rules:
        - Never leave any <<<<<<< ======= >>>>>>> markers in your output
        - Never truncate — return the complete file every time
        - Every fix must be directly traceable to a specific test failure
        - If a test expected "X attacked Y!" and you returned "Y attacked X!", fix that exact logic
        - Keep all logic that passed tests — only change what failed

        You MUST return ONLY a valid JSON object. No markdown, no explanation, no preamble. Start with { and end with }.

        Return format:
        {
          "failures_identified": ["brief description of each failure you identified and why it happened"],
          "fixes_applied": ["brief description of each fix you made and which test it addresses"],
          "resolution_1": {
            "strategy": "one sentence describing your approach",
            "resolved_file": "<complete file content>"
          },
          "resolution_2": {
            "strategy": "one sentence describing your approach",
            "resolved_file": "<complete file content>"
          }
        }'''
            },
            {
                'role': 'user',
                'content': f'''Your previous merge resolutions failed some tests. Learn from the feedback and generate 2 improved resolutions.

        BRANCH A INTENT:
        {commit_msg_a}

        BRANCH B INTENT:
        {commit_msg_b}

        ORIGINAL FILE WITH CONFLICTS:
        {file_with_conflicts}

        CONTEXT FILES:
        {context_text}

        FEEDBACK FROM ALL PREVIOUS ATTEMPTS:
        {feedback_text}

        Now generate 2 new resolutions that fix every failed test above.
        Focus especially on the FAILED tests — read the expected vs actual values and trace back exactly which logic in your merge caused the mismatch.
        Return only the raw JSON object. Start with {{ and end with }}. Nothing else.'''
            }
        ]
    )

    raw_output = learn.message.content if getattr(learn, "message", None) else ""
    if not raw_output:
        return {"error": "Model returned an empty response."}
    print(raw_output)

    try:
        parsed = json.loads(raw_output)
    except (TypeError, ValueError):
        parsed = {"raw_response": raw_output}

    return parsed


async def handle_ws_connection(websocket, path):
    print("kkkkk")
    if path == "/generate-tests":
        print("jjjj")
        async for raw_message in websocket:
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON payload."}))
                continue

            print("nnnn")
            file_content = payload.get("fileContent", "")
            commit_message = payload.get("commit_message", "")
            affected_functions = payload.get("conflict_functions", [])
            intent = payload.get("intent", "")

            if isinstance(affected_functions, str):
                affected_functions = [affected_functions]
            if not isinstance(affected_functions, list):
                await websocket.send(json.dumps({"error": "conflict_functions must be a list[str]."}))
                continue

            try:
                print("huhhh")
                results = multithread(
                    intent,
                    {
                        'commit_msg': commit_message,
                        'modifications': file_content,
                        'affected_files': affected_functions
                    }
                )
                print("cowabunga")
                await websocket.send(json.dumps(results, ensure_ascii=True))
            except Exception as exc:
                try:
                    await websocket.send(json.dumps({"error": str(exc)}, ensure_ascii=True))
                except Exception:
                    pass

    elif path == "/generate-merge":
        print("jj")
        async for raw_message in websocket:
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON payload."}))
                continue

            file_content = payload.get("file_content", "")
            commit_message_a = payload.get("commit_message_a", "")
            commit_message_b = payload.get("commit_message_b", "")
            ancestor_files = payload.get("ancestor_functions_other_files", "")

            if not isinstance(file_content, str) or not file_content.strip():
                await websocket.send(json.dumps({"error": "file_content is required."}))
                continue

            try:
                response = merge(
                    file_content,
                    commit_message_a,
                    commit_message_b,
                    ancestor_files,  
                )
                await websocket.send(json.dumps(merge_return, ensure_ascii=True))
            except Exception as exc:
                await websocket.send(json.dumps({"error": str(exc)}, ensure_ascii=True))

    elif path == "/generate-feedback":
        print("vv")
        async for raw_message in websocket:
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON payload."}))
                continue

            file_content = payload.get("file_content", "")
            commit_message_a = payload.get("commit_message_a", "")
            commit_message_b = payload.get("commit_message_b", "")
            ancestor_files = payload.get("ancestor_functions_other_files", [])
            previous_attempts = payload.get("previous_attempts", [])

            if not isinstance(file_content, str) or not file_content.strip():
                await websocket.send(json.dumps({"error": "file_content is required."}))
                continue
            if not isinstance(previous_attempts, list):
                await websocket.send(json.dumps({"error": "previous_attempts must be a list."}))
                continue

            if isinstance(ancestor_files, str):
                ancestor_files = [ancestor_files] if ancestor_files else []

            try:
                response = feedback_merge(
                    previous_attempts,
                    commit_message_a,
                    commit_message_b,
                    file_content,      
                    ancestor_files,     
                )
                await websocket.send(json.dumps(response, ensure_ascii=True))
            except Exception as exc:
                await websocket.send(json.dumps({"error": str(exc)}, ensure_ascii=True))

    elif path == "/generate-intent":
        print(f"wjfoiewjfioewji{path}")
        async for raw_message in websocket:
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON payload."}))
                continue

            graph = payload.get("graph", {})
            local = payload.get("local", "")
            remote = payload.get("remote", "")
            file = payload.get("file", "")

            print(file)
            
            if not local or not remote:
                await websocket.send(json.dumps({"error": "local and remote commit messages are required."}))
                continue
            
            try:
                merge_return = await merge(file)
                response = gain_understanding_of_project_return_viable_solutions(
                    graph,
                    local,
                    remote
                )
                await websocket.send(json.dumps(response, ensure_ascii=True))
            except Exception as exc:
                await websocket.send(json.dumps({"error": str(exc)}, ensure_ascii=True))

    elif path == "/generate-validate":
        async for raw_message in websocket:
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON payload."}))
                continue

            results = payload.get("results", {})
            tests = payload.get("tests", [])
            
            if not local or not remote:
                await websocket.send(json.dumps({"error": "local and remote commit messages are required nigganigga."}))
                continue
            
            try:
                response = validator(
                    results,
                    tests
                )
                await websocket.send(json.dumps(response, ensure_ascii=True))
            except Exception as exc:
                await websocket.send(json.dumps({"error": str(exc)}, ensure_ascii=True))

    else:
        await websocket.send(json.dumps({"error": f"Unsupported path: {path}"}))
        return


async def main():
    host = "0.0.0.0"
    port = 8050
    async with serve(handle_ws_connection, host, port, max_size=10_485_760):
        print(f"[pipeline3] WebSocket server listening on ws://{host}:{port}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
    
    

# target_job = {'commit_msg':Prompts.COMMIT_MESSAGE, 'context':Prompts.DESCRIPTION, 'modifications':Prompts.FILE_CHANGE, 'affected_files':Prompts.AFFECTED_FUNCTION}

# multithread("merge in the best way you think possible", target_job)
