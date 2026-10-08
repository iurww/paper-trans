import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/reader.css';
import App from './app/App.jsx';

const theme = createTheme({ primaryColor: 'teal', fontFamily: 'system-ui, -apple-system, sans-serif' });
createRoot(document.getElementById('app')).render(<MantineProvider theme={theme} forceColorScheme="light"><App /></MantineProvider>);
