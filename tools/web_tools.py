from ddgs import DDGS

def web_search(query: str, max_results: int = 3) -> str:
    """
    Searches the web using DuckDuckGo and returns the results.
    Useful for finding current information, news, or factual answers.
    """
    try:
        results = DDGS().text(query, max_results=max_results)
        if not results:
            return f"No results found for query: {query}"
        
        formatted_results = []
        for i, res in enumerate(results):
            formatted_results.append(f"{i+1}. Title: {res.get('title')}\n   Snippet: {res.get('body')}\n   URL: {res.get('href')}")
            
        return "\n\n".join(formatted_results)
    except Exception as e:
        return f"Error during web search: {str(e)}"
