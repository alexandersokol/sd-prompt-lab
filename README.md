# SD Prompt Lab

🚀 **SD Prompt Lab** is an extension for [AUTOMATIC1111's Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) designed to enhance your prompt crafting experience. It offers a suite of tools to streamline prompt creation, management, and utilization.

## Features

- **Prompt Editor with Syntax Highlighting**: Craft prompts effortlessly with an editor that supports syntax highlighting for various elements, including:
  - **LoRA embeddings**: Recognizes patterns like `<lora:embedding_name>`.
  - **Parentheses and Braces**: Highlights nested structures for better readability.

- **Autocomplete Suggestions**: As you type, receive suggestions based on prompts you already saved.
- **Common Prompts**: Frequently used common prompts such as masterpiece or score_9, can be updated manually in common_prompts.txt.
- **Unwanted Prompts**: Alerts you to prompts that are commonly avoided or deprecated, can be updated in unwanted_prompts.txt.

- **Prompt Management**: Save, edit, and organize your prompts within the extension for easy access and reuse.

- **Dynamic Prompts aware editor**: Highlights [Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts) syntax (variants, wildcards, variables) and underlines mistakes: unbalanced brackets, malformed or missing wildcards, a stray `|`, misplaced variable definitions and misspelled words.

- **Wildcard Editor**: Browse, search (by name or file content) and edit your wildcard files in a tabbed editor. *Note*: This feature requires the [Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts) extension to be installed, and wildcards files added.

- **Prompt comments**: Keep notes in a prompt without affecting the image, and write your own entries to the image metadata. See [Prompt comments](#prompt-comments).

- **Settings**: Manage the saved autocompletion prompts and switch spell checking and prompt comments on or off.

- **Image Handling in 'Create' Tab**:
  - **Local Images**: Browse and select images from your local storage.
  - **Remote Images**: Paste direct image URLs (e.g., `http://example.com/image.png`). The extension will download, create a thumbnail, and manage the image appropriately.

## Installation

1. **Prerequisites**:
   - Ensure you have [AUTOMATIC1111's Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) installed and running.

2. **Install SD Prompt Lab**:
   - Navigate to the `Extensions`, `Install from URL` directory of your Stable Diffusion WebUI installation.
   - Paste the link to this repository:
     ```bash
     https://github.com/alexandersokol/sd-prompt-lab.git
     ```
   - Restart the WebUI to recognize the new extension.

3. **Optional - Enable Wildcards Integration**:
   - To utilize the Wildcards feature, install the [Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts) extension.

## Usage

- **Accessing the Extension**: Once installed, a new tab labeled "Prompt Lab" will appear in the WebUI. Navigate to this tab to access all features.

- **Editing Prompts**: Use the editor to craft your prompts. Syntax highlighting and autocomplete features will assist in creating effective prompts.

- **Managing Prompts**: Save your frequently used prompts for quick access. Organize them as needed for different projects or themes.

- **Wildcards**: If the Dynamic Prompts extension is enabled, the Wildcards tab will allow you to browse and manage your wildcard files and directories.

## Prompt comments

Two kinds of comment can be written in the positive or negative prompt of txt2img and img2img:

| Syntax | Used for generation | In the image metadata |
|---|---|---|
| `/* any note */` | no | stays in the prompt text |
| `/*@ Name: value */` | no | moved to the parameter line, next to Steps, Sampler, … |

For example, generating with

```
1girl, {red|blue} dress, /* outfit test */ /*@ Mood: calm */
```

is the same as generating with `1girl, {red|blue} dress,` and saves this metadata:

```
1girl, red dress, /* outfit test */
Steps: 20, Sampler: Euler a, …, Mood: calm
```

- A param name may contain letters, digits, `_` and spaces. Names the WebUI or Dynamic Prompts write themselves (`Steps`, `Seed`, `Template`, …) are reserved: such a comment is kept as a plain note and a warning is shown under the image.
- If a name is set more than once in a prompt, the last one wins.
- Nothing inside a comment is expanded by Dynamic Prompts, so any character is safe.
- A `/*` without a closing `*/` is not a comment; the editor warns about it.
- When a saved prompt is sent to txt2img or copied from Prompt Lab, `/*@ Prompt name: <name> */` is added, so the image records which template it came from. It is not stored in the saved prompt.
- The feature can be switched off in the Prompt Lab Settings tab.

Limits:

- Comments that come from wildcard files or saved WebUI styles are inserted after the protection runs, so `# $ % { }` and `__` inside them are still read by Dynamic Prompts. The Wildcard Editor warns about these.
- The txt2img token counter also counts comment text.
- Extensions that encode the prompt again in a pass of their own may still see plain notes.
- If params differ between the images of one run, the grid image carries those of the last image.

## Notes

- **Compatibility**: SD Prompt Lab is designed to work seamlessly with the latest version of AUTOMATIC1111's Stable Diffusion WebUI. Ensure both the WebUI and all extensions are up to date for the best experience.

- **Support**: For issues or feature requests, please open an issue in this repository, and/or create PR.

Happy prompting! ✨
