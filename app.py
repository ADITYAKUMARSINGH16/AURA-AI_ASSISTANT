import streamlit as st
import warnings
from agent import create_agent
from voice import speak, listen

# Suppress standard warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

st.set_page_config(page_title="AURA", page_icon="🤖", layout="wide")
st.title("🤖 AURA Web Interface")

# Initialize agent in session state
if "agent" not in st.session_state:
    st.session_state.agent = create_agent()

agent = st.session_state.agent

# Sidebar controls
with st.sidebar:
    st.header("Controls")
    voice_input = st.button("🎤 Speak to AURA", help="Click to use microphone (runs locally)")
    use_voice_output = st.checkbox("🔊 Enable Voice Output", value=True)

# Display chat messages from history
for msg in agent.messages:
    if msg.get('role') == 'system':
        continue
    
    if msg.get('role') == 'user':
        with st.chat_message("user"):
            st.markdown(msg.get('content', ''))
            
    elif msg.get('role') == 'assistant':
        # Check if assistant made tool calls
        if msg.get('tool_calls'):
            for tool_call in msg['tool_calls']:
                name = tool_call['function']['name']
                args = tool_call['function']['arguments']
                with st.chat_message("assistant", avatar="🛠️"):
                    with st.expander(f"Used tool: `{name}`"):
                        st.json(args)
        if msg.get('content'):
            with st.chat_message("assistant"):
                st.markdown(msg['content'])
                
    elif msg.get('role') == 'tool':
        with st.chat_message("assistant", avatar="⚙️"):
            with st.expander(f"Result from `{msg.get('name', 'tool')}`"):
                st.markdown(f"```text\n{msg.get('content', '')}\n```")

# Handle input
user_input = None

if voice_input:
    with st.spinner("Listening for 5 seconds..."):
        user_input = listen()
        if user_input == "SWITCH_TO_TEXT_MODE":
            user_input = None
            st.warning("Voice input failed or was cancelled.")

if prompt := st.chat_input("Type your message to AURA here..."):
    user_input = prompt
    
if user_input:
    with st.spinner("AURA is thinking..."):
        response = agent.send_message(user_input)
        if use_voice_output and response:
            speak(response)
    st.rerun()
