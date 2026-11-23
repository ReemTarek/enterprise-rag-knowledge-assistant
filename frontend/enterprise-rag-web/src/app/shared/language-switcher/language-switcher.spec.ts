import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/i18n.testing';
import { LanguageService } from '../../core/i18n/language.service';
import { LanguageSwitcher } from './language-switcher';

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LanguageSwitcher],
      providers: [provideI18nTesting()],
    }).compileComponents();
  });

  it('LanguageSwitcher_RendersNativeNames_AndSwitches', async () => {
    const fixture = TestBed.createComponent(LanguageSwitcher);
    await fixture.whenStable();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Change language');

    button.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const items = Array.from(overlay.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    expect(items.map((i) => i.textContent?.trim())).toEqual(['English', 'Deutsch', 'العربية']);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items[2].getAttribute('aria-checked')).toBe('false');

    items[2].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(TestBed.inject(LanguageService).current()).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
