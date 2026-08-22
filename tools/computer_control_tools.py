import time
import logging

try:
    import pyautogui
    pyautogui.FAILSAFE = True
    # Add a slight delay after all pyautogui commands to ensure UI catches up
    pyautogui.PAUSE = 0.5 
except ImportError:
    logging.warning("pyautogui is not installed. Computer control tools will fail.")

def click_text(text_to_find: str) -> str:
    """Finds exact text on the screen using OCR and clicks it. Use this instead of blind coordinates whenever possible. Returns the new visual state of the screen."""
    import pyautogui
    from PIL import ImageGrab
    import pytesseract
    
    screenshot = ImageGrab.grab()
    
    try:
        data = pytesseract.image_to_data(screenshot, output_type=pytesseract.Output.DICT)
    except Exception as e:
        return f"OCR failed, cannot click text '{text_to_find}': {e}"
        
    found_x, found_y = None, None
    target = text_to_find.lower()
    
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
                # Y2 takes max height among the words
                y2 = max([data['top'][i+k] + data['height'][i+k] for k in range(len(target_words))])
                
                found_x = x1 + ((x2 - x1) // 2)
                found_y = y1 + ((y2 - y1) // 2)
                break
                
    if found_x and found_y:
        pyautogui.moveTo(found_x, found_y, duration=0.5)
        pyautogui.click()
        time.sleep(1.5) # Wait for UI to settle
        
        from .system_tools import read_screen
        new_state = read_screen(prompt=f"Action taken: Clicked on text '{text_to_find}'. Describe the new state of the screen.")
        return f"Successfully clicked '{text_to_find}'. New screen state:\n{new_state}"
    else:
        return f"Failed to find text '{text_to_find}' on screen. Consider using click_coordinates if OCR fails."

def click_coordinates(x: int, y: int, button: str = "left", double_click: bool = False) -> str:
    """Clicks at exact screen coordinates. Only use if click_text is impossible. Returns the new visual state."""
    import pyautogui
    pyautogui.moveTo(x, y, duration=0.5)
    
    if double_click:
        pyautogui.doubleClick(button=button)
    else:
        pyautogui.click(button=button)
        
    time.sleep(1.5)
    from .system_tools import read_screen
    action_desc = "Double-clicked" if double_click else f"Clicked ({button})"
    new_state = read_screen(prompt=f"Action taken: {action_desc} at coordinates ({x}, {y}). Describe the new state of the screen.")
    return f"Successfully clicked coordinates ({x}, {y}). New screen state:\n{new_state}"

def type_text(text: str, press_enter: bool = False) -> str:
    """Types the given text on the keyboard. Use this after focusing a text field. Returns the new visual state."""
    import pyautogui
    
    pyautogui.write(text, interval=0.02)
    if press_enter:
        pyautogui.press('enter')
        
    time.sleep(1.5)
    from .system_tools import read_screen
    new_state = read_screen(prompt=f"Action taken: Typed text '{text}'. Describe the new state of the screen.")
    return f"Successfully typed text. New screen state:\n{new_state}"

def press_key(key: str) -> str:
    """Presses a single key (e.g., 'enter', 'esc', 'tab', 'win'). Returns the new visual state."""
    import pyautogui
    
    pyautogui.press(key)
    time.sleep(1.5)
    
    from .system_tools import read_screen
    new_state = read_screen(prompt=f"Action taken: Pressed key '{key}'. Describe the new state of the screen.")
    return f"Successfully pressed '{key}'. New screen state:\n{new_state}"

def scroll(amount: int) -> str:
    """Scrolls the screen vertically. Positive amount scrolls up, negative scrolls down. Returns the new visual state."""
    import pyautogui
    
    pyautogui.scroll(amount)
    time.sleep(1.5)
    
    from .system_tools import read_screen
    new_state = read_screen(prompt=f"Action taken: Scrolled by {amount}. Describe the new state of the screen.")
    return f"Successfully scrolled. New screen state:\n{new_state}"

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
