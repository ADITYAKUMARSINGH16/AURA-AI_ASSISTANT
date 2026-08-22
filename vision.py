import base64
import io
import json
import logging
from PIL import Image, ImageStat
import ollama
import pytesseract
import os

# Automatically find Tesseract on Windows if it's not in PATH
if os.name == 'nt' and os.path.exists(r"C:\Program Files\Tesseract-OCR\tesseract.exe"):
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from config import OLLAMA_VISION_MODEL

VISION_MODEL = OLLAMA_VISION_MODEL

def is_image_valid(base64_str: str) -> tuple[bool, str]:
    """Validates if an image contains actual visual information to prevent hallucinations."""
    try:
        if base64_str.startswith('data:image'):
            base64_str = base64_str.split(',', 1)[1]
            
        img_data = base64.b64decode(base64_str)
        img = Image.open(io.BytesIO(img_data)).convert('RGB')
        
        # Check if the image is too small to be meaningful (e.g. 1x1)
        if img.width <= 1 or img.height <= 1:
            return False, "The image is too small (e.g., 1x1) to contain visual information."
            
        # Check if image is a single solid color
        extrema = img.getextrema()
        # extrema is a tuple for each band: ((Rmin, Rmax), (Gmin, Gmax), (Bmin, Bmax))
        if all(min_val == max_val for min_val, max_val in extrema):
            return False, "The image consists of a single solid color. No visual information is present."
            
        return True, ""
    except Exception as e:
        logging.error(f"Image validation failed: {e}")
        return False, f"Invalid image format or decoding error."

def analyze_vision_payload(base64_str: str, user_prompt: str = "") -> str:
    """Analyzes the image using OCR and a dedicated Vision LLM to return structured context."""
    valid, err_msg = is_image_valid(base64_str)
    if not valid:
        return json.dumps({
            "source": "Internal Vision Pipeline Validation",
            "error": err_msg,
            "detected_text": "",
            "description": "Image validation failed. Tell the user the image is blank or solid and cannot be analyzed."
        })
        
    if base64_str.startswith('data:image'):
        base64_str = base64_str.split(',', 1)[1]

    # 1. OCR Fallback
    ocr_text = ""
    try:
        img_data = base64.b64decode(base64_str)
        img = Image.open(io.BytesIO(img_data))
        ocr_text = pytesseract.image_to_string(img).strip()
    except Exception as e:
        logging.warning(f"OCR extraction failed or Tesseract not configured: {e}")

    # 2. Vision LLM Analysis
    vision_prompt = f"""You are an internal computer vision analysis module.
Your job is to deeply analyze the provided image and return a strictly structured JSON response summarizing its contents.
Do not output anything outside of the JSON block.
If the image is a screenshot, identify the applications, windows, and UI elements.
If the image is an error message, read it carefully.
If the image is a photograph or chart, explain it.

User's original query related to this image: "{user_prompt}"

Return ONLY valid JSON in this format:
{{
  "detected_text": "Summary of visible text. Note: I also have raw OCR text provided below.",
  "ui_elements_or_objects": "Describe buttons, windows, applications, charts, or physical objects",
  "warnings_or_errors": "Any error dialogues, warnings, or red flags seen",
  "overall_description": "A comprehensive paragraph describing the entire image",
  "confidence": "High, Medium, or Low"
}}"""

    try:
        res = ollama.chat(
            model=VISION_MODEL,
            messages=[
                {
                    'role': 'user',
                    'content': vision_prompt,
                    'images': [base64_str]
                }
            ]
        )
        
        vision_content = res['message']['content']
        # Try to parse the JSON if the model added backticks
        if "```json" in vision_content:
            vision_content = vision_content.split("```json")[1].split("```")[0].strip()
        elif "```" in vision_content:
            vision_content = vision_content.split("```")[1].strip()
            
        try:
            # Validate JSON
            parsed_json = json.loads(vision_content)
        except json.JSONDecodeError:
            # Fallback if VLM didn't output strict JSON
            parsed_json = {
                "detected_text": "See OCR.",
                "ui_elements_or_objects": "Unknown",
                "warnings_or_errors": "Unknown",
                "overall_description": vision_content,
                "confidence": "Low"
            }
            
        # Combine OCR and VLM structured context
        structured_context = {
            "source": "Internal Vision Pipeline",
            "ocr_exact_text": ocr_text,
            "vlm_analysis": parsed_json
        }
        
        return json.dumps(structured_context, indent=2)
        
    except Exception as e:
        logging.error(f"Vision model analysis failed: {e}")
        return json.dumps({
            "source": "Internal Vision Pipeline Error",
            "error": f"Failed to connect to vision model: {e}",
            "ocr_exact_text": ocr_text
        })
