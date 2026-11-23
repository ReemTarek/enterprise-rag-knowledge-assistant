import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
});
