// Reuses the native Enter sequence verified by the IMP-03 Chrome harness.
export function pressEnterInChrome() {
  // Cypress 16's native Enter omits the character event; its type('{enter}')
  // emits a non-bubbling click, which cannot reach React's delegated listener.
  // Supply the complete native CDP keystroke in this Chrome-only lab harness.
  // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
  cy.then(() =>
    Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      },
    }),
  );
  cy.then(() =>
    Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      },
    }),
  );
}

// Native focus traversal and scrolling: no synthetic DOM keydown or .focus().
// CDP modifiers use Shift=8: https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
export function pressKeyInChrome(
  key: 'Tab' | 'Escape' | 'ArrowRight',
  shift = false,
) {
  const code = { Tab: 9, Escape: 27, ArrowRight: 39 }[key];
  for (const type of ['keyDown', 'keyUp']) {
    cy.then(() =>
      Cypress.automation('remote:debugger:protocol', {
        command: 'Input.dispatchKeyEvent',
        params: {
          type,
          key,
          code: key,
          modifiers: shift ? 8 : 0,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code,
        },
      }),
    );
  }
}
