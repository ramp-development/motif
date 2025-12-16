/**
 * Navigation Manager
 *
 * Handles navigation buttons (prev/next/submit) states based on Form State.
 * coordinates with managers to progress through the form.
 */

import type { CardItem, FieldItem, GroupItem, SetItem } from '../types';
import { BaseManager } from './base-manager';

/**
 * NavigationManager Implementation
 *
 * Discovers navigation buttons and emits navigation:next/prev events.
 * Listens for boundary events to update button states.
 */
export class NavigationManager extends BaseManager {
  private navigationEnabled: boolean = true;
  private enterKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Initialize the manager
   */
  public init(): void {
    this.groupStart(`Initializing Navigation`);
    this.setupEventListeners();

    this.form.logDebug('Initialized');
    this.groupEnd();
  }

  /**
   * Cleanup manager resources
   */
  public destroy(): void {
    this.removeEventListeners();

    this.form.logDebug('NavigationManager destroyed');
  }

  // ============================================
  // Event Listeners
  // ============================================

  /**
   * Setup event listeners for button clicks and boundary events
   */
  private setupEventListeners(): void {
    this.form.subscribe('form:navigation:request', (payload) => {
      this.handleMove(payload.type);
    });

    this.setupEnterKeyListener();

    this.form.logDebug('Event listeners setup');
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    if (this.enterKeyHandler) {
      document.removeEventListener('keydown', this.enterKeyHandler);
      this.enterKeyHandler = null;
    }
  }

  /**
   * Setup global Enter key listener for form progression
   * Allows users to press Enter to advance through the form
   */
  private setupEnterKeyListener(): void {
    this.enterKeyHandler = (event: KeyboardEvent) => {
      // Only respond to Enter without shift key
      if (event.key !== 'Enter' || event.shiftKey) return;
      this.form.logDebug('Enter key pressed', { event });

      // Check if focus is within this form
      const formElement = this.form.getRootElement()!;
      const { activeElement } = document;
      const isWithinForm = formElement.contains(activeElement);

      if ((!isWithinForm && activeElement !== document.body) || activeElement?.tagName === 'BUTTON')
        return;

      // Prevent default form submission or other Enter key behaviors
      event.preventDefault();

      // determine whether to navigate or submit
      const nextOrSubmit = this.form.buttonManager.determineNextOrSubmit();

      if (nextOrSubmit === 'next') {
        // Request navigation to next step
        this.form.emit('form:navigation:request', { type: 'next' });
      } else {
        // Request form submission
        this.form.emit('form:submit:requested', {});
      }
    };

    document.addEventListener('keydown', this.enterKeyHandler);
    this.form.logDebug('Global Enter key listener setup');
  }

  // ============================================
  // Navigation requests
  // ============================================

  /**
   * Handle move in a direction
   */
  public handleMove(direction: 'prev' | 'next' | 'submit'): void {
    if (!this.navigationEnabled) return;

    const canMove =
      (direction === 'next' && this.validateCurrent()) ||
      (direction === 'submit' && this.validateCurrent()) ||
      direction === 'prev';
    const behavior = this.form.getBehavior();
    const destination = behavior.toLowerCase().replace('by', '');

    if (canMove) {
      this.logDebug(`Navigating to ${direction} ${destination}`);
    } else {
      this.logDebug(`Cannot navigate to ${direction} ${destination}`);
      this.form.emit('form:navigation:denied', { reason: 'invalid' });
      return;
    }

    if (direction === 'submit') {
      this.byCard('next');
      return;
    }

    switch (behavior) {
      case 'byField':
        this.byField(direction);
        break;
      case 'byGroup':
        this.byGroup(direction);
        break;
      case 'bySet':
        this.bySet(direction);
        break;
      case 'byCard':
        this.byCard(direction);
        break;
      default:
        throw this.form.createError('Invalid behavior', 'runtime', {
          cause: { behavior },
        });
    }
  }

  private validateCurrent(): boolean {
    const inputsToValidate = this.form.inputManager.getByFilter(
      (input) => input.active && input.isIncluded
    );

    return inputsToValidate.every((input) => input.isValid);
  }

  /**
   * Navigate to next field (byField behavior)
   */
  private byField(direction: 'prev' | 'next'): 'field' | 'group' | 'set' | 'card' | undefined {
    const targetPosition =
      direction === 'prev'
        ? this.form.fieldManager.getPrevPosition()
        : this.form.fieldManager.getNextPosition();

    // At end of fields - check if we can advance to next group/set/card
    if (targetPosition === undefined) {
      return this.byGroup(direction);
    }

    const targetField = this.form.fieldManager.getByIndex(targetPosition);
    if (!targetField) {
      throw this.form.createError('Cannot handle navigation: target field is null', 'runtime', {
        cause: { targetPosition, targetField, direction },
      });
    }

    this.clearHierarchyData('field');
    this.setChildrenActive(targetField);
    this.updateHierarchyData(targetField);
    this.batchStateUpdates();

    return 'field';
  }

  /**
   * Navigate to next group (byGroup behavior)
   */
  private byGroup(direction: 'prev' | 'next'): 'group' | 'set' | 'card' | undefined {
    const targetPosition =
      direction === 'prev'
        ? this.form.groupManager.getPrevPosition()
        : this.form.groupManager.getNextPosition();

    // At end of groups - check if we can advance to next group/set/card
    if (targetPosition === undefined) {
      return this.bySet(direction);
    }

    const targetGroup = this.form.groupManager.getByIndex(targetPosition);
    if (!targetGroup) {
      throw this.form.createError('Cannot handle navigation: target group is null', 'runtime', {
        cause: { targetPosition, targetGroup, direction },
      });
    }

    // Clear active flags
    this.clearHierarchyData('group');

    // Set new group active and current
    // this.form.groupManager.updateItemData(targetGroup.id, { active: true, current: true });
    this.form.groupManager.setActive(targetGroup.id);
    this.form.groupManager.setCurrent(targetGroup.id);
    this.setChildrenActive(targetGroup);
    this.updateHierarchyData(targetGroup);
    this.batchStateUpdates();

    return 'group';
  }

  /**
   * Navigate to next group (byGroup behavior)
   */
  private bySet(direction: 'prev' | 'next'): 'set' | 'card' | undefined {
    const targetPosition =
      direction === 'prev'
        ? this.form.setManager.getPrevPosition()
        : this.form.setManager.getNextPosition();

    // At end of sets - check if we can advance to next group/set/card
    if (targetPosition === undefined) {
      return this.byCard(direction);
    }

    const targetSet = this.form.setManager.getByIndex(targetPosition);
    if (!targetSet) {
      throw this.form.createError('Cannot handle navigation: target set is null', 'runtime', {
        cause: { targetPosition, targetSet, direction },
      });
    }

    // Clear active flags
    this.clearHierarchyData('set');

    // Set new group active and current
    this.form.setManager.setActive(targetSet.id);
    this.form.setManager.setCurrent(targetSet.id);
    this.setChildrenActive(targetSet);
    this.updateHierarchyData(targetSet);
    this.batchStateUpdates();

    return 'set';
  }

  /**
   * Navigate to next group (byGroup behavior)
   */
  private byCard(direction: 'prev' | 'next'): 'card' | undefined {
    const targetPosition =
      direction === 'prev'
        ? this.form.cardManager.getPrevPosition()
        : this.form.cardManager.getNextPosition();

    // At end of cards - check if we can advance to next group/set/card
    if (targetPosition === undefined) {
      // this.handleFormComplete();
      return undefined;
    }

    const targetCard = this.form.cardManager.getByIndex(targetPosition);
    if (!targetCard) {
      throw this.form.createError('Cannot handle navigation: target card is null', 'runtime', {
        cause: { targetPosition, targetCard, direction },
      });
    }

    // Clear active flags
    this.clearHierarchyData('card');

    // Set new group active and current
    this.form.cardManager.setActive(targetCard.id);
    this.form.cardManager.setCurrent(targetCard.id);
    this.setChildrenActive(targetCard);
    this.batchStateUpdates();

    return 'card';
  }

  /**
   * Clear child metadata for any element
   * Cascades down the hierarchy: card → set → group → field
   * Clears all levels below and including the given element type
   *
   * @param elementType - The element type to start clearing from
   */
  private clearHierarchyData(elementType: 'card' | 'set' | 'group' | 'field'): void {
    // Clear card and below
    if (elementType === 'card') {
      this.form.cardManager.clearActiveAndCurrent();
    }

    // Clear set and below
    if (elementType === 'card' || elementType === 'set') {
      this.form.setManager.clearActiveAndCurrent();
    }

    // Clear group and below
    if (elementType === 'card' || elementType === 'set' || elementType === 'group') {
      this.form.groupManager.clearActiveAndCurrent();
    }

    // Clear field (always cleared for all element types)
    this.form.fieldManager.clearActiveAndCurrent();
  }

  /**
   * Set children active (first is current)
   */
  private setChildrenActive(element: CardItem | SetItem | GroupItem | FieldItem): void {
    if (element.type === 'card') {
      this.form.setManager.setActiveByParent(element.id, element.type, { firstIsCurrent: true });
    }

    if (element.type === 'card' || element.type === 'set') {
      this.form.groupManager.setActiveByParent(element.id, element.type, { firstIsCurrent: true });
    }

    if (element.type === 'card' || element.type === 'set' || element.type === 'group') {
      this.form.fieldManager.setActiveByParent(element.id, element.type, { firstIsCurrent: true });
    }

    this.form.inputManager.clearActiveAndCurrent();
    const activeFields = this.form.fieldManager.getActive();
    activeFields.forEach((field, index) => {
      this.form.inputManager.setActiveByParent(field.id, 'field', {
        firstIsCurrent: index === 0,
      });
    });
  }

  /**
   * Update parent metadata for any element
   * Cascades up the hierarchy: field � group � set � card
   * Only updates parents that exist in the element's hierarchy
   *
   * @param element - Any form element (field, group, set, card)
   */
  private updateHierarchyData(element: SetItem | GroupItem | FieldItem): void {
    // Update group (only if element is a field)
    if (element.type === 'field') {
      const { groupIndex } = element.parentHierarchy;
      if (groupIndex !== null && groupIndex >= 0) {
        this.form.groupManager.clearActiveAndCurrent();
        this.form.groupManager.setActive(groupIndex);
        this.form.groupManager.setCurrent(groupIndex);
      }
    }

    // Update set (if element is field or group)
    if (element.type === 'field' || element.type === 'group') {
      const { setIndex } = element.parentHierarchy;
      if (setIndex !== null && setIndex >= 0) {
        this.form.setManager.clearActiveAndCurrent();
        this.form.setManager.setActive(setIndex);
        this.form.setManager.setCurrent(setIndex);
      }
    }

    // Update card (always, since all elements have a parent card)
    const { cardIndex } = element.parentHierarchy;
    if (cardIndex !== null && cardIndex >= 0) {
      this.form.cardManager.clearActiveAndCurrent();
      this.form.cardManager.setActive(cardIndex);
      this.form.cardManager.setCurrent(cardIndex);
    }
  }

  /**
   * Batch all manager state calculations into one setStates() call
   * Prevents multiple state:changed events and DisplayManager flicker
   */
  private batchStateUpdates(): void {
    this.form.inputManager.rebuildAll();
    this.form.fieldManager.rebuildAll();
    this.form.groupManager.rebuildAll();
    this.form.setManager.rebuildAll();
    this.form.cardManager.rebuildAll();

    // Collect state from all managers (doesn't write to state yet)
    const allStates = {
      ...this.form.inputManager.calculateStates(),
      ...this.form.fieldManager.calculateStates(),
      ...this.form.groupManager.calculateStates(),
      ...this.form.setManager.calculateStates(),
      ...this.form.cardManager.calculateStates(),
    };

    // Batch update all states
    this.form.setStates(allStates);
  }
}
