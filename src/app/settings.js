const SETTINGS_KEY = 'paperlens-settings-v1';
export const SIDEBAR_KEY = 'paperlens-sidebar-collapsed';

const defaultSettings = {
  endpoint: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-flash',
  key: '',
};

export function loadSettings() {
  try {
    const { visionKey, ...saved } = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...defaultSettings, ...saved, model: !saved.model || saved.model === 'deepseek-chat' ? defaultSettings.model : saved.model, key: saved.key || visionKey || '' };
  }
  catch { return { ...defaultSettings }; }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
