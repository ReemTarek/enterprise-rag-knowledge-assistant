import { ANIMATION_MODULE_TYPE } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideI18nTesting } from '../../core/i18n/i18n.testing';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  function open() {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting(),
        { provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' },
      ],
    });
    const ref = TestBed.inject(MatDialog).open(ConfirmDialog, {
      data: { title: 'Delete it?', message: 'This cannot be undone.' },
    });
    let result: boolean | undefined;
    ref.afterClosed().subscribe((r) => (result = r));
    return { ref, result: () => result };
  }
  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove()));
  const btn = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

  it('ConfirmDialog_ShowsTranslatedTexts_AndReturnsTrueOnConfirm', async () => {
    const d = open();
    await vi.waitFor(() => expect(btn('confirm-yes')).not.toBeNull());
    await vi.waitFor(() => expect(document.body.textContent).toContain('Delete it?'));
    expect(document.body.textContent).toContain('This cannot be undone.');
    btn('confirm-yes').click();
    await vi.waitFor(() => expect(d.result()).toBe(true));
  });

  it('ConfirmDialog_Cancel_ReturnsFalse', async () => {
    const d = open();
    await vi.waitFor(() => expect(btn('confirm-no')).not.toBeNull());
    btn('confirm-no').click();
    await vi.waitFor(() => expect(d.result()).toBe(false));
  });
});
