import { ATTR } from '../constants';
import type {
  ButtonItem,
  ButtonParentElement,
  ButtonParentHierarchy,
  ButtonType,
  SubmitRequestedEvent,
} from '../types';
import { HierarchyBuilder, ItemStore, parseElementAttribute, sentenceCase } from '../utils';
import { BaseManager } from './base-manager';

/**
 * ButtonManager Implementation
 *
 * Discover buttons within the form hierarchy.
 * Implements lazy event binding - only the active buttons are bound to events.
 */
export class ButtonManager extends BaseManager {
  private store = new ItemStore<ButtonItem>();

  /** Active event listeners for cleanup */
  private activeListeners: Array<{
    button: HTMLButtonElement;
    index: number;
    type: ButtonType;
    event: 'click';
    handler: EventListener;
  }> = [];

  /**
   * Initialize the manager
   */
  public init(): void {
    this.groupStart(`Initializing Buttons`);
    this.discoverItems();
    this.setupEventListeners();
    this.applyStates(true);

    this.logDebug('Initialized');
    this.groupEnd();
  }

  /**
   * Cleanup manager resources
   */
  public destroy(): void {
    this.store.clear();
    this.unbindAllButtons();

    this.logDebug('ButtonManager destroyed');
  }

  // ============================================
  // Discovery
  // ============================================

  /**
   * Discover all navigation buttons in the form
   * Finds buttons with [data-form-element="prev"], [data-form-element="next"], [data-form-element="submit"]
   */
  public discoverItems(): void {
    const rootElement = this.form.getRootElement();
    if (!rootElement) {
      throw this.form.createError(
        'Cannot discover navigation buttons: root element is null',
        'init',
        {
          cause: rootElement,
        }
      );
    }

    // Query all buttons
    const items = this.form.queryAll<HTMLElement>(
      `[${ATTR}-element="prev"], [${ATTR}-element="next"], [${ATTR}-element="submit"]`
    );

    this.store.clear();

    items.forEach((item, index) => {
      const itemData = this.createItemData(item, index);
      if (!itemData) return;

      this.store.add(itemData);
    });

    this.logDebug(`Discovered ${this.store.length} buttons`);
  }

  private createItemData(element: HTMLElement, index: number): ButtonItem | undefined {
    if (!(element instanceof HTMLElement)) return;

    const attrValue = element.getAttribute(`${ATTR}-element`);
    if (!attrValue) return;

    const parsed = parseElementAttribute(attrValue);

    // Skip if not prev, next or submit
    if (!['prev', 'next', 'submit'].includes(parsed.type)) return;

    /**
     * Button is hopefully the element with attribute applied
     * Otherwise, check if there's a button inside
     * Otherwise, check if there's a link inside
     * Otherwise throw an error
     */
    const button =
      element instanceof HTMLButtonElement
        ? element
        : (element.querySelector<HTMLButtonElement>(`button`) ??
          element.querySelector<HTMLAnchorElement>('a'));

    if (!button) {
      throw this.form.createError('Cannot discover navigation buttons: button is null', 'init', {
        cause: element,
      });
    }

    if (button instanceof HTMLAnchorElement) {
      throw this.form.createError('Cannot discover navigation buttons: button is a link', 'init', {
        cause: element,
      });
    }

    const id = `${parsed.type}-button-${index}`;

    // Create button item object
    return this.buildItemData({
      element,
      index,
      id,
      active: false, // Calculated
      type: parsed.type as ButtonType,
      parentHierarchy: this.findParentHierarchy(element),
      button,
      originalText: this.getText(button),
      disabled: true, // Calculated
      visible: false, // Calculated
    });
  }

  /**
   * Build button item data
   * Used during discovery and state updates
   * Single source of truth for button data calculation
   */
  private buildItemData(item: ButtonItem): ButtonItem {
    const active = this.determineActive(item.element);
    // const visible = this.determineVisible(item.type);
    const visible = true;
    const enabled = this.determineEnabled(item.type, active && visible);

    return {
      ...item,
      active,
      visible,
      disabled: !enabled,
    };
  }

  /**
   * Determine if item should be active based on parent and behavior
   * Default implementation - can be overridden if needed
   *
   * @param element - HTMLElement to check
   * @returns Whether element should be active
   */
  protected determineActive(element: HTMLElement): boolean {
    // Get parent based on element type
    const parent = this.findParentItem(element);
    return parent ? parent.active : true;
  }

  /**
   * Determine whether a button should be visible
   * - Need to get the parent hierarchy
   * - Check if parent Id is the currently active Card/Set
   */
  private determineVisible(type: ButtonType): boolean {
    const { current, total } = this.getRelevantState();
    const { currentCardIndex, totalCards, currentSetIndex, totalSets } = this.form.getAllState();

    switch (type) {
      case 'prev':
        return (totalCards > 0 && currentCardIndex > 0) || (totalSets > 0 && currentSetIndex > 0);
      case 'next':
        return current !== total - 1;
      case 'submit':
        return current === total - 1;
    }
  }

  private determineEnabled(type: ButtonType, activeAndVisible: boolean = true): boolean {
    if (!activeAndVisible) return false;

    const valid = this.form.inputManager
      .getByFilter((input) => input.active && input.isIncluded)
      .every((input) => input.isValid);

    // const { current, total } = this.getRelevantState();

    switch (type) {
      case 'prev':
        return activeAndVisible;
      case 'next':
        return valid;
      case 'submit':
        return valid;
    }
  }

  private getRelevantState(): { current: number; total: number } {
    const behavior = this.form.getBehavior();
    const state = this.form.getAllState();

    let current: number;
    let total: number;

    switch (behavior) {
      case 'byField':
        current = state.currentFieldIndex;
        total = state.totalFields;
        break;
      case 'byGroup':
        current = state.currentGroupIndex;
        total = state.totalGroups;
        break;
      case 'bySet':
        current = state.currentSetIndex;
        total = state.totalSets;
        break;
      case 'byCard':
        current = state.currentCardIndex;
        total = state.totalCards;
        break;
      default:
        throw this.form.createError(
          'Cannot determine button visibility: invalid behavior',
          'init',
          { cause: behavior }
        );
    }

    return { current, total };
  }

  private findParentHierarchy(child: HTMLElement): ButtonParentHierarchy {
    return HierarchyBuilder.findParentHierarchy<ButtonParentHierarchy>(
      child,
      this.form,
      (element) => this.findParentItem(element)
    );
  }

  /**
   * Find the parent item for a field
   *
   * @param element - The field element
   * @returns Parent data or null
   */
  protected findParentItem(element: HTMLElement): ButtonParentElement | undefined {
    const parentSet = HierarchyBuilder.findParentByElement(element, 'set', () =>
      this.form.setManager.getAll()
    );

    const parentCard = HierarchyBuilder.findParentByElement(element, 'card', () =>
      this.form.cardManager.getAll()
    );

    return parentSet ?? parentCard;
  }

  /**
   * Setup event listeners for button clicks
   */
  private setupEventListeners(): void {
    this.bindActiveButtons();

    this.form.subscribe('form:navigation:changed', () => {
      this.calculateStates();
      this.applyStates();
      this.handleActiveButtons();
    });

    this.form.subscribe('form:input:changed', () => {
      this.calculateStates();
      this.applyStates();
    });

    this.form.subscribe('form:condition:evaluated', () => {
      this.calculateStates();
      this.applyStates();
    });

    this.logDebug('Event listeners setup');
  }

  // ============================================
  // Bind Listeners
  // ============================================

  /**
   * Bind events to the current buttons
   */
  public bindActiveButtons(): void {
    const activeItems = this.getActive();
    if (activeItems.length === 0) return;

    activeItems.forEach((item) => {
      const { button } = item;

      // If already bound, skip
      const alreadyBound = this.activeListeners.some((listener) => listener.button === button);
      if (alreadyBound) return;

      // Bind event to button
      const handler: EventListener = () => {
        this.handleClick(item.type);
      };

      button.addEventListener('click', handler);
      this.activeListeners.push({
        button,
        index: item.index,
        type: item.type,
        event: 'click',
        handler,
      });

      const parent = this.findParentItem(item.element);
      if (!parent) return;

      this.logDebug(
        `Bound "click" events to "${item.type}" button within ${parent.type} "${parent.id}"`
      );
    });
  }

  /**
   * Unbind all inactive button listeners
   * @internal Used during cleanup
   */
  private unbindInactiveButtons(): void {
    const activeItems = this.getActive();
    if (activeItems.length === 0) return;

    this.activeListeners = this.activeListeners.filter((listener) => {
      const shouldRemove = !activeItems.find((item) => item.index === listener.index);

      if (shouldRemove) {
        listener.button.removeEventListener(listener.event, listener.handler);

        const parent = this.findParentItem(listener.button);
        if (parent) {
          this.logDebug(
            `Unbound "${listener.event}" events from "${listener.type}" button within ${parent.type} "${parent.id}"`
          );
        }
      }

      return !shouldRemove; // Keep listeners that should NOT be removed
    });
  }

  /**
   * Unbind all button listeners
   * @internal Used during cleanup
   */
  private unbindAllButtons(): void {
    this.activeListeners.forEach((listener) => {
      listener.button.removeEventListener(listener.event, listener.handler);
    });
    this.activeListeners = [];
  }

  // ============================================
  // Button Click Handlers
  // ============================================

  /**
   * Handle button clicks
   */
  private handleClick = (type: 'prev' | 'next' | 'submit'): void => {
    if (type === 'submit') {
      /** @update submit event and payload */
      const payload: SubmitRequestedEvent = {};
      this.logDebug('Submit button clicked: requesting form submission');
      this.form.emit('form:submit:request', payload);
      return;
    }

    this.logDebug(`${sentenceCase(type)} button clicked: requesting navigation`);
    this.form.emit('form:navigation:request', { type });
  };

  // ============================================
  // Button State Management
  // ============================================

  private calculateStates(): void {
    this.getAll().forEach((item) => {
      const updated = this.buildItemData(item);
      this.store.update(updated);
    });
  }

  /**
   * Handle context change
   */
  private handleActiveButtons(): void {
    this.unbindInactiveButtons();
    this.bindActiveButtons();
  }

  /**
   * Update button states based on current navigation position
   * Called after state changes
   */
  public applyStates(isInitial: boolean = false): void {
    this.logDebug(`${isInitial ? 'Initializing' : 'Updating'} button states`);

    this.getAll().forEach((item) => {
      item.button.disabled = item.disabled;
      if (item.visible) {
        item.element.style.removeProperty('display');
      } else {
        item.element.style.display = 'none';
      }
    });
  }

  // ============================================
  // Private Helpers
  // ============================================

  /** Get all button elements */
  private getAll(): ButtonItem[] {
    return this.store.getAll();
  }

  /** Get by type */
  private getByType(type: ButtonType): ButtonItem[] {
    return this.store.filter((item) => item.type === type);
  }

  /** Get active */
  private getActive(): ButtonItem[] {
    return this.store.filter((button) => button.active && button.visible);
  }

  /** Get all buttons by parent */
  private getAllByParent(parentHierarchy: ButtonParentHierarchy): ButtonItem[] {
    return this.store.filter((item) => item.parentHierarchy === parentHierarchy);
  }

  /** Get all buttons of type by parent*/
  private getTypeByParent(parentHierarchy: ButtonParentHierarchy, type: ButtonType): ButtonItem[] {
    const allByParent = this.getAllByParent(parentHierarchy);
    return allByParent.filter((button) => button.type === type);
  }

  /** Get the button text */
  private getText(element: HTMLElement): string {
    const textElement = element.querySelector(`[${ATTR}-element="button-text"]`);
    if (!textElement) return element.textContent ?? '';
    return textElement.textContent ?? '';
  }

  // ============================================
  // Public Helpers
  // ============================================

  /** Set the button text */
  public setText(element: HTMLElement, text?: string): void {
    const itemElement = element.dataset.button
      ? element
      : element.closest<HTMLElement>('[data-button]');
    if (!itemElement) return;

    const item = this.store.getByDOM(itemElement);
    const setText = text ?? item?.originalText ?? '';
    if (!setText) return;

    const textElement = itemElement.querySelector(`[${ATTR}-element="button-text"]`);
    if (!textElement) element.textContent = setText;
    else textElement.textContent = setText;
  }

  /** Get the submit button */
  public getSubmit(): ButtonItem | undefined {
    return this.store.getAll().find((item) => item.active && item.type === 'submit');
  }

  /**  */
  public determineNextOrSubmit(): 'next' | 'submit' {
    const active = this.getActive();

    const next = active.find((button) => button.type === 'next');
    if (next) {
      this.logDebug('Next button found');
      return 'next';
    }

    const submit = active.find((button) => button.type === 'submit');
    if (submit) {
      this.logDebug('Submit button found');
      return 'submit';
    }

    return 'next';
  }
}
