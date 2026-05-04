"""Sample Python file for code-map scanner tests."""
import os
from .y import a, b

MAX_BATCH_SIZE = 100
DEBUG_MODE = False

# A simple class
class Foo:
    """Foo class."""

    def __init__(self, name: str) -> None:
        self.name = name

    async def fetch(self, url: str) -> str:
        """Async fetch method."""
        return url

def simple_function(x: int) -> int:
    """A simple module-level function."""
    return x * 2

@route('/x')
def decorated_function(request):
    """A decorated function."""
    return request
