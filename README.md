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

- **Wildcards Integration**: Navigate and manage your wildcards seamlessly within the extension. *Note*: This feature requires the [Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts) extension to be installed and enabled, and wildcards files added.

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

## Notes

- **Compatibility**: SD Prompt Lab is designed to work seamlessly with the latest version of AUTOMATIC1111's Stable Diffusion WebUI. Ensure both the WebUI and all extensions are up to date for the best experience.

- **Support**: For issues or feature requests, please open an issue in this repository, and/or create PR.

Happy prompting! ✨
