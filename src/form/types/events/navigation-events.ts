/**
 * Navigation Events
 */
export interface NavigationRequestEvent {
  type: 'prev' | 'next' | 'submit';
}

export interface NavigationChangedEvent {
  target: 'card' | 'set' | 'group' | 'field';
}

export interface NavigationDeniedEvent {
  reason: 'invalid' | 'disabled' | 'hidden' | 'required';
}
