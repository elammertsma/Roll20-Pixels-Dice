import React from 'react';
import { createRoot } from 'react-dom/client';
import Bridge from './Bridge';
import '../index.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Bridge />);
}
