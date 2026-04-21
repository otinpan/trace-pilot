# Change Log
## [0.1.0] 
- released: 2026/04/01

## [1.1.0]
- released: 2026/04/21
* Implemented OpenSummary to support responses based on multiple interactions with the LLM.
* OpenSummary clarifies the intent of pasted text by summarizing the most recent three prompt-response pairs from the conversation history.
* This addresses cases such as prompts like "fix previous code", where the intent cannot be understood without prior context.
* When no recent prompt-response history is available, OpenSummary falls back to summarizing from the single prompt-response pair contained in the pasted text.

![](Assets/OpenSummary_original_pair.png)
![](Assets/OpenSummary.png)
