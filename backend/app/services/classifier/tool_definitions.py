"""OpenAI Tool/Function definitions for the classifier.

These define what tools the LLM can call during classification.
The actual execution happens in tool_executor.py.
"""

CLASSIFIER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_tags",
            "description": (
                "Search for existing tags in Paperless-ngx that match a keyword. "
                "Returns tag names that contain the search term. Use this to find "
                "relevant tags before assigning them. Call multiple times with "
                "different keywords if needed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword to search for in tag names (e.g. 'Rechnung', 'Versicherung', 'Steuer')"
                    }
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_correspondents",
            "description": (
                "Search for existing correspondents in Paperless-ngx. "
                "Returns correspondent names that match the search term. "
                "Use this to find the correct correspondent for the document."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Name or part of name to search for (e.g. 'Telekom', 'AOK', 'Finanzamt')"
                    }
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_document_types",
            "description": (
                "Get all available document types in Paperless-ngx. "
                "Returns the full list since there are typically few types. "
                "Only assign types from this list."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_storage_paths",
            "description": (
                "Get all configured storage path profiles with person info and context. "
                "Each profile describes which documents belong to that path. "
                "Read the context_prompt carefully to decide which path fits best."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_custom_field_definitions",
            "description": (
                "Get the list of active custom fields that should be extracted from the document. "
                "Each field has a name, type, extraction prompt, and example values. "
                "Only call this if custom field extraction is enabled."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
]


CLASSIFICATION_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": ["string", "null"],
            "description": "Suggested document title, or null to keep current"
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of tag names to assign. Prefer existing tags from search_tags, but you may suggest one new tag if nothing fits."
        },
        "correspondent": {
            "type": ["string", "null"],
            "description": "Correspondent name (from search_correspondents) or null"
        },
        "document_type": {
            "type": ["string", "null"],
            "description": "Document type name (from get_document_types) or null"
        },
        "storage_path_id": {
            "type": ["integer", "null"],
            "description": "Storage path ID (from get_storage_paths) or null"
        },
        "storage_path_reason": {
            "type": ["string", "null"],
            "description": "Brief reason for the storage path choice"
        },
        "created_date": {
            "type": ["string", "null"],
            "description": "Document creation date in YYYY-MM-DD format, or null"
        },
        "custom_fields": {
            "type": "object",
            "description": "Extracted custom field values, keyed by field name",
            "additionalProperties": {"type": ["string", "number", "boolean", "null"]}
        },
    },
    "required": ["title", "tags", "correspondent", "document_type",
                 "storage_path_id", "created_date", "custom_fields"],
    "additionalProperties": False,
}
