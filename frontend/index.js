import { registerRootComponent } from 'expo';
import React from 'react';
import App from './App';
import { useAggroFonts } from './Typography';

// Gate here rather than inside App so App's hook order stays untouched.
function Root() {
  const fontsLoaded = useAggroFonts();
  return fontsLoaded ? <App /> : null;
}

registerRootComponent(Root);
