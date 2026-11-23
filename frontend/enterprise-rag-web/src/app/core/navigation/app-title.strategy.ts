import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { combineLatest, map, switchMap, take } from 'rxjs';

/** Route `title` is a translation key; the document title becomes "<translated> - <app name>" and follows language changes. */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);
  private key: string | undefined;

  constructor() {
    super();
    this.transloco.langChanges$
      .pipe(switchMap(() => this.translate()))
      .subscribe((t) => this.title.setTitle(t));
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key = this.buildTitle(snapshot);
    this.translate().subscribe((t) => this.title.setTitle(t));
  }

  private translate() {
    const keys = this.key ? [this.key, 'app.name'] : ['app.name'];
    return combineLatest(keys.map((k) => this.transloco.selectTranslate(k))).pipe(
      take(1),
      map((parts) => parts.join(' - ')),
    );
  }
}
