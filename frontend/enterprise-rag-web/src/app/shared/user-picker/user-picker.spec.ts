import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/i18n.testing';
import { DirectoryUser } from './directory-user';
import { UserPicker } from './user-picker';

const ADA: DirectoryUser = { id: 'a', displayName: 'Ada Lovelace', email: 'ada@example.com' };
const GRACE: DirectoryUser = { id: 'g', displayName: 'Grace Hopper', email: 'grace@example.com' };

describe('UserPicker', () => {
  let search: ReturnType<typeof vi.fn>;
  let f: ComponentFixture<UserPicker>;

  async function setup(exclude: string[] = []) {
    TestBed.configureTestingModule({ imports: [UserPicker], providers: [provideI18nTesting()] });
    search = vi.fn(() => of([ADA, GRACE]));
    f = TestBed.createComponent(UserPicker);
    f.componentRef.setInput('search', search);
    f.componentRef.setInput('excludeIds', exclude);
    await f.whenStable();
  }
  const input = () => (f.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input')!;
  const type = (v: string) => {
    input().value = v;
    input().dispatchEvent(new Event('input'));
  };

  it('UserPicker_SearchesAfterDebounce_AndEmitsSelection', async () => {
    await setup();
    const picked: (DirectoryUser | null)[] = [];
    f.componentInstance.selected.subscribe((u) => picked.push(u));
    input().focus();
    type('ada');
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('ada'));
    await f.whenStable();
    const option = await vi.waitFor(() => {
      const o = Array.from(document.querySelectorAll<HTMLElement>('mat-option')).find((x) =>
        x.textContent?.includes('Ada Lovelace'),
      );
      if (!o) throw new Error('no option');
      return o;
    });
    option.click();
    await f.whenStable();
    expect(picked.at(-1)).toEqual(ADA);
    type('adx'); // editing clears the selection
    expect(picked.at(-1)).toBeNull();
  });

  const status = () =>
    (f.nativeElement as HTMLElement).querySelector('[role="status"]')!.textContent ?? '';
  const options = () => Array.from(document.querySelectorAll('mat-option'));

  it('UserPicker_ShortQuery_CancelsInFlightSearch_StaleResponseIgnored', async () => {
    await setup();
    const response = new Subject<DirectoryUser[]>();
    search.mockImplementation(() => response);
    input().focus();
    type('ada');
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('ada'));
    expect(response.observed).toBe(true);

    type('a'); // below the minimum: the in-flight request is dropped at once
    expect(response.observed).toBe(false);
    response.next([ADA, GRACE]); // a late answer for 'ada' cannot repopulate the list
    await f.whenStable();
    expect(options()).toHaveLength(0);
    expect(status()).not.toContain('No matching users.');
  });

  it('UserPicker_SearchError_ShowsTranslatedMessage_ThenRecovers', async () => {
    await setup();
    search.mockImplementation(() => throwError(() => new Error('boom')));
    input().focus();
    type('ada');
    await vi.waitFor(() => expect(status()).toContain('User search failed. Try again.'));
    expect(status()).not.toContain('boom');

    search.mockImplementation(() => of([GRACE]));
    type('gra');
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('gra'));
    await f.whenStable();
    expect(status()).not.toContain('User search failed');
  });

  it('UserPicker_ExcludesGivenIds', async () => {
    await setup(['a']);
    input().focus();
    type('gr');
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    await f.whenStable();
    const texts = Array.from(document.querySelectorAll('mat-option')).map((o) => o.textContent);
    expect(texts.some((t) => t?.includes('Ada'))).toBe(false);
    expect(texts.some((t) => t?.includes('Grace'))).toBe(true);
  });

  it('UserPicker_SearchInput_IsDirAuto_AndOptionsAreBidiIsolated', async () => {
    await setup();
    // Name-or-email search: the direction follows what is typed (Latin email or Arabic name).
    expect(input().getAttribute('dir')).toBe('auto');
    input().focus();
    type('ada');
    await vi.waitFor(() => expect(options().length).toBe(2));
    const first = options()[0];
    const isolated = Array.from(first.querySelectorAll('bdi')).map((b) => b.textContent!.trim());
    expect(isolated).toEqual(['Ada Lovelace', 'ada@example.com']);
  });

  // The hint is long (German wraps to two lines): with dynamic subscript sizing the field grows to fit it instead of
  // drawing the second line over whatever follows the picker.
  it('UserPicker_HintField_UsesDynamicSubscriptSizing', async () => {
    await setup();
    const field = (f.nativeElement as HTMLElement).querySelector('mat-form-field')!;
    expect(field.querySelector('mat-hint')).not.toBeNull();
    const subscript = field.querySelector('.mat-mdc-form-field-subscript-wrapper')!;
    expect(subscript.classList).toContain('mat-mdc-form-field-subscript-dynamic-size');
  });
});
