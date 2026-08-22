import time
import logging
import json
import base64
import io
import os

try:
    import pyautogui
    pyautogui.FAILSAFE = True
    # Add a slight delay after all pyautogui commands to ensure UI catches up
    pyautogui.PAUSE = 0.5 
except ImportError:
    logging.warning("pyautogui is not installed. Computer control tools will fail.")

def execute_visual_task(goal: str, require_confirmation: bool = False) -> str:
    """
    Executes a UI goal using a closed-loop visual agent (OBSERVE -> PLAN -> ACT -> VERIFY).
    It uses Qwen3-VL to understand the screen and PyAutoGUI to interact.
    """
    import ollama
    from PIL import ImageGrab
    
    # Destructive check (simple heuristic for safety)
    destructive_keywords = ['delete', 'format', 'uninstall', 'remove', 'reset', 'kill', 'drop']
    is_destructive = any(word in goal.lower() for word in destructive_keywords)
    
    if is_destructive and not require_confirmation:
        return f"WARNING: The goal '{goal}' appears destructive. Please confirm with the user before proceeding, and set require_confirmation=True."

    max_retries = 3
    timeout_seconds = 60
    start_time = time.time()
    
    history_context = []
    
    for attempt in range(max_retries + 1):
        if time.time() - start_time > timeout_seconds:
            return f"Task failed: Exceeded {timeout_seconds}s timeout while trying to achieve '{goal}'."
            
        logging.info(f"[VISUAL_AGENT] Attempt {attempt+1}/{max_retries+1} for goal: {goal}")
        
        # 1. OBSERVE
        screenshot = ImageGrab.grab()
        # Save for HUD
        capture_dir = os.path.join("static", "captures")
        os.makedirs(capture_dir, exist_ok=True)
        screenshot.save(os.path.join(capture_dir, "last_screen.png"))
        
        img_opt = screenshot.convert("RGB")
        img_opt.thumbnail((1280, 1280))
        img_byte_arr = io.BytesIO()
        img_opt.save(img_byte_arr, format='JPEG', quality=85)
        b64_str = base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')
        
        # 2. PLAN
        prompt = f"""
You are a closed-loop visual agent operating a computer.
Your ultimate goal is: "{goal}"

Previous actions/history in this loop:
{json.dumps(history_context, indent=2) if history_context else "None (first step)."}

Analyze the current screen and determine the NEXT action required to achieve the goal, OR verify if the goal is already achieved.
Do NOT output coordinates blindly. Look for semantic text or labels to click.

Output ONLY valid JSON in this exact schema:
{{
  "verification": "Describe whether the goal is already achieved based on this screenshot.",
  "is_achieved": true/false,
  "reasoning": "Why this action is needed next or why it failed previously.",
  "action": "click_text" | "type_text" | "press_key" | "scroll" | "done",
  "action_args": {{
      // if click_text: "text": "exact text on screen"
      // if type_text: "text": "text to type", "press_enter": true/false
      // if press_key: "key": "enter", "esc", "win", etc.
      // if scroll: "amount": int (positive for up, negative for down)
  }}
}}
"""
        try:
            res = ollama.chat(
                model="qwen3-vl", 
                messages=[{'role': 'user', 'content': prompt, 'images': [b64_str]}],
                format="json"
            )
            plan = json.loads(res['message']['content'])
        except Exception as e:
            logging.error(f"[VISUAL_AGENT] Planning failed: {e}")
            return f"Task failed: Error connecting to qwen3-vl or parsing JSON. {str(e)}"
            
        logging.info(f"[VISUAL_AGENT] Plan: {plan}")
        
        if plan.get("is_achieved") or plan.get("action") == "done":
            return f"Success! Goal '{goal}' achieved. Verification: {plan.get('verification')}"
            
        # 3. ACT
        action = plan.get("action")
        args = plan.get("action_args", {})
        action_result = ""
        
        try:
            if action == "click_text":
                import pytesseract
                # Find text using OCR
                data = pytesseract.image_to_data(screenshot, output_type=pytesseract.Output.DICT)
                target = args.get("text", "").lower()
                found_x, found_y = None, None
                
                # Check single words
                for i, word in enumerate(data['text']):
                    if word.strip().lower() == target:
                        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                        found_x = x + (w // 2)
                        found_y = y + (h // 2)
                        break
                        
                # If not found as single word, check for consecutive words
                if not found_x and " " in target:
                    target_words = target.split()
                    for i in range(len(data['text']) - len(target_words) + 1):
                        match = True
                        for j, t_word in enumerate(target_words):
                            if data['text'][i+j].strip().lower() != t_word:
                                match = False
                                break
                        if match:
                            x1 = data['left'][i]
                            y1 = data['top'][i]
                            last_idx = i + len(target_words) - 1
                            x2 = data['left'][last_idx] + data['width'][last_idx]
                            y2 = max([data['top'][i+k] + data['height'][i+k] for k in range(len(target_words))])
                            
                            found_x = x1 + ((x2 - x1) // 2)
                            found_y = y1 + ((y2 - y1) // 2)
                            break
                            
                if found_x and found_y:
                    pyautogui.moveTo(found_x, found_y, duration=0.5)
                    pyautogui.click()
                    action_result = f"Clicked text '{target}'"
                else:
                    action_result = f"Failed to find text '{target}' on screen via OCR."
                    
            elif action == "type_text":
                pyautogui.write(args.get("text", ""), interval=0.02)
                if args.get("press_enter"):
                    pyautogui.press('enter')
                action_result = f"Typed '{args.get('text')}'"
                
            elif action == "press_key":
                pyautogui.press(args.get("key", ""))
                action_result = f"Pressed key '{args.get('key')}'"
                
            elif action == "scroll":
                pyautogui.scroll(args.get("amount", 0))
                action_result = f"Scrolled by {args.get('amount')}"
                
            else:
                action_result = f"Unknown action requested: {action}"
                
        except pyautogui.FailSafeException:
            logging.warning("[VISUAL_AGENT] Emergency Stop triggered!")
            return "Task aborted: Emergency stop triggered by user (mouse moved to screen corner)."
        except Exception as e:
            action_result = f"Exception during action execution: {e}"

        history_context.append({
            "attempt": attempt + 1,
            "plan_reasoning": plan.get("reasoning"),
            "intended_action": action,
            "execution_result": action_result
        })
        
        # 4. VERIFY (Loops back to OBSERVE in the next iteration)
        time.sleep(1.5) # Wait for UI to settle before next screenshot
        
    return f"Task failed: Exceeded maximum retries ({max_retries}) without achieving goal '{goal}'. Final verification failed. History: {json.dumps(history_context)}"

def get_active_window() -> str:
    """Returns the title of the currently active/focused window."""
    try:
        import pygetwindow as gw
        active = gw.getActiveWindow()
        if active:
            return f"Active Window Title: '{active.title}'"
        return "No active window found."
    except ImportError:
        return "Error: pygetwindow is not installed."
    except Exception as e:
        return f"Error getting active window: {e}"
