import os

def list_directory(path: str = ".") -> str:
    """
    Lists the contents of a specified directory.
    If no path is provided, it lists the current directory.
    """
    try:
        items = os.listdir(path)
        return "\n".join(items) if items else "Directory is empty."
    except Exception as e:
        return f"Error listing directory: {str(e)}"

def read_file(file_path: str) -> str:
    """
    Reads the text content of a file.
    Only returns up to the first 2000 characters to prevent overflowing the assistant's memory.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            if len(content) > 2000:
                return content[:2000] + "\n...[TRUNCATED]"
            return content
    except Exception as e:
        return f"Error reading file: {str(e)}"
