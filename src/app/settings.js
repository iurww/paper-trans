const SETTINGS_KEY = 'paperlens-settings-v1';
export const SIDEBAR_KEY = 'paperlens-sidebar-collapsed';

const defaultSettings = {
  endpoint: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',
  key: '',
  visionKey: '',
};

export function loadSettings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...defaultSettings }; }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
