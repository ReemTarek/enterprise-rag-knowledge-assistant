import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideI18nTesting } from './core/i18n/i18n.testing';
import { LanguageService } from './core/i18n/language.service';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideI18nTesting()],
    }).compileComponents();
  });

  it('App creates', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('App_InitialisesLanguage', () => {
    const init = vi.spyOn(TestBed.inject(LanguageService), 'init');
    TestBed.createComponent(App);
    expect(init).toHaveBeenCalledOnce();
  });
});
