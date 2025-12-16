import type { FlowupsForm } from '..';
import { BaseManager } from './base-manager';

export class SubmitManager extends BaseManager {
  private formElement: HTMLFormElement;

  constructor(form: FlowupsForm) {
    super(form);
    this.formElement = this.discoverForm();
  }

  public init(): void {
    this.groupStart(`Initializing Submit`);
    this.discoverForm();
    this.setupEventListeners();

    this.logDebug('Initialized', {
      formElement: this.formElement,
    });
    this.groupEnd();
  }

  public destroy(): void {
    this.logDebug('SubmitManager destroyed');
  }

  private setupEventListeners(): void {
    this.form.subscribe('form:submit:requested', () => {
      this.handleSubmit();
    });

    this.formElement.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleSubmit();
    });

    this.form.subscribe('form:submit:error', (payload) => {
      this.logDebug('Form submit error', { error: payload.error });
      this.showError(payload.error.message);
    });
  }

  private discoverForm(): HTMLFormElement {
    const rootElement = this.form.getRootElement();
    if (!rootElement) {
      throw this.form.createError('Cannot discover form: root element is null', 'init', {
        cause: rootElement,
      });
    }

    let formElement: HTMLFormElement;

    if (!(rootElement instanceof HTMLFormElement)) {
      const childForm = rootElement.querySelector('form');
      if (!childForm) {
        throw this.form.createError('Cannot discover form: child form is null', 'init', {
          cause: rootElement,
        });
      }

      formElement = childForm;
    } else {
      formElement = rootElement;
    }

    return formElement;
  }

  public handleSubmit(): void {
    this.logDebug('Form submit requested', {
      data: this.form.getState('formData'),
    });

    this.form.emit('form:submit:started', {});
  }

  public setLoading(isLoading: boolean): void {
    const submit = this.form.buttonManager.getSubmit();
    if (!submit) return;

    submit.button.disabled = isLoading;
    this.form.buttonManager.setText(submit.button, isLoading ? 'Submitting...' : undefined);
  }

  public showSuccess(): void {
    this.form.emit('form:navigation:request', { type: 'submit' });
  }

  public showError(message: string, timeout?: number): void {
    this.form.emit('form:error:triggered', { message, timeout });
  }
}
