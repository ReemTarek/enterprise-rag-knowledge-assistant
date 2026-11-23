import { ANIMATION_MODULE_TYPE, ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideI18nTesting } from '../../../core/i18n/i18n.testing';
import { TEMP_PASSWORD } from '../users.testing';
import { TempPasswordDialog, TempPasswordDialogData } from './temp-password-dialog';

describe('TempPasswordDialog', () => {
  function open(data?: TempPasswordDialogData, disableClose = true) {
    TestBed.configureTestingModule({
      providers: [provideI18nTesting(), { provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' }],
    });
    const payload = data ?? { email: 'grace@example.com', displayName: 'Grace', password: TEMP_PASSWORD };
    const ref = TestBed.inject(MatDialog).open(TempPasswordDialog, {
      data: payload,
      disableClose,
    }) as MatDialogRef<TempPasswordDialog, void>;
    return { ref, payload };
  }
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  const ready = async () => {
    await vi.waitFor(() => expect(q('close')).not.toBeNull());
    await TestBed.inject(ApplicationRef).whenStable();
  };
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.dir = 'ltr';
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove());
  });

  const pressEscape = () =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }),
    );

  it('TempPasswordDialog_Control_EscapeAndBackdropClose_WhenDisableCloseIsFalse', async () => {
    const { ref } = open(undefined, false);
    let closed = false;
    ref.afterClosed().subscribe(() => (closed = true));
    await ready();
    pressEscape();
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it('TempPasswordDialog_Control_BackdropClickCloses_WhenDisableCloseIsFalse', async () => {
    const { ref } = open(undefined, false);
    let closed = false;
    ref.afterClosed().subscribe(() => (closed = true));
    await ready();
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  function stubClipboard(impl: () => Promise<void>) {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it('TempPasswordDialog_ShowsPasswordAndWarning_AndDropsItFromDialogData', async () => {
    const { payload } = open();
    await ready();
    expect((q('password-field') as HTMLInputElement).value).toBe(TEMP_PASSWORD);
    expect(q('password-field').hasAttribute('readonly')).toBe(true);
    expect(document.body.textContent).toContain('shown only once');
    expect(document.body.textContent).toContain('grace@example.com');
    expect(payload.password).toBe('');
  });

  it('TempPasswordDialog_PasswordFieldIsLtr', async () => {
    document.documentElement.dir = 'rtl';
    open();
    await ready();
    expect(q('password-field').getAttribute('dir')).toBe('ltr');
    document.documentElement.dir = 'ltr';
  });

  it('TempPasswordDialog_CopyButton_UsesClipboard_AndHandlesFailure', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    open();
    await ready();
    q('copy').click();
    await vi.waitFor(() => expect(q('copy-status').textContent).toContain('Copied'));
    expect(writeText).toHaveBeenCalledWith(TEMP_PASSWORD);
    expect(q('copy-status').getAttribute('aria-live')).toBe('polite');

    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    q('copy').click();
    await vi.waitFor(() => expect(q('copy-status').textContent).toContain('manually'));
    expect(q('copy-status').textContent).not.toContain(TEMP_PASSWORD);
  });

  it('TempPasswordDialog_Copy_WithoutClipboardApi_ShowsManualHint', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    open();
    await ready();
    q('copy').click();
    await vi.waitFor(() => expect(q('copy-status').textContent).toContain('manually'));
  });

  it('TempPasswordDialog_Close_RequiresAcknowledgement', async () => {
    const { ref } = open();
    let closed = false;
    ref.afterClosed().subscribe(() => (closed = true));
    await ready();
    const close = q('close') as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    close.click();
    expect(closed).toBe(false);
    // Escape and backdrop do not dismiss it either.
    pressEscape();
    q('ack').closest('.cdk-overlay-container')!.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
    await Promise.resolve();
    expect(closed).toBe(false);
    q('ack').querySelector<HTMLInputElement>('input')!.click();
    await vi.waitFor(() => expect((q('close') as HTMLButtonElement).disabled).toBe(false));
    expect(closed).toBe(false);
    q('close').click();
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it('TempPasswordDialog_Close_NullsThePassword', async () => {
    const { ref } = open();
    await ready();
    const component = ref.componentInstance;
    expect(component.password()).toBe(TEMP_PASSWORD);
    q('ack').querySelector<HTMLInputElement>('input')!.click();
    await vi.waitFor(() => expect((q('close') as HTMLButtonElement).disabled).toBe(false));
    q('close').click();
    await vi.waitFor(() => expect(component.password()).toBeNull());
  });

  it('TempPasswordDialog_Destroy_NullsThePassword', async () => {
    const { ref } = open();
    await ready();
    const component = ref.componentInstance;
    ref.close();
    await vi.waitFor(() => expect(component.password()).toBeNull());
  });
});
