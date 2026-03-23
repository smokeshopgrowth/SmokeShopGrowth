# One-Off Utility Scripts

These scripts were used for one-time Vapi assistant migrations and are kept here
for reference only. They are **not** part of the main pipeline.

All credentials must come from environment variables (`.env`). Never hardcode API keys.

| Script | Purpose |
|---|---|
| `clone_voice.py` | Copy a voice profile from one Vapi assistant to another |
| `patch_assistant_prompt.py` | Update the system prompt on the production Vapi assistant |
| `patch_voice_speed.py` | Set the voice speed on the production Vapi assistant |

## Usage

```bash
# Make sure your .env has VAPI_API_KEY, VAPI_ASSISTANT_ID set
python scripts/patch_assistant_prompt.py
python scripts/patch_voice_speed.py

# For clone_voice.py also set OLD_VAPI_API_KEY and OLD_VAPI_ASSISTANT_ID
python scripts/clone_voice.py
```
