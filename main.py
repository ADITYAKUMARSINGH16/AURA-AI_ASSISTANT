import sys
import warnings

# Suppress standard warnings to keep console clean for voice output
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)
from agent import create_agent
from config import OLLAMA_MODEL
from voice import speak, listen

def main():
    print(f"Initializing AURA (Model: {OLLAMA_MODEL})...")
    
    try:
        chat = create_agent()
        print("\nAURA is online. Type 'exit' or 'quit' to end the session.")
        
        mode = input("Select mode (text/voice) [text]: ").strip().lower()
        if not mode:
            mode = 'text'
            
        while True:
            try:
                if mode == 'voice':
                    user_input = listen()
                    if user_input == "SWITCH_TO_TEXT_MODE":
                        mode = 'text'
                        continue
                    if not user_input:
                        continue
                else:
                    user_input = input("\nYou: ")
            except EOFError:
                break
            except KeyboardInterrupt:
                speak("Goodbye, sir.")
                break
            
            if user_input.strip().lower() in ['exit', 'quit']:
                speak("Goodbye, sir.")
                break
                
            if not user_input.strip():
                continue
                
            try:
                response = chat.send_message(user_input)
                speak(response)
            except Exception as e:
                print(f"\nAURA [Error]: I'm sorry, I encountered an issue communicating with Ollama: {str(e)}")
                print(f"Make sure Ollama is running and the model '{OLLAMA_MODEL}' is downloaded.")
                
    except Exception as e:
        print(f"Failed to initialize AURA: {str(e)}")

if __name__ == "__main__":
    main()
