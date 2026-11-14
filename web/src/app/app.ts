import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api, Session } from './api';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (session.user(); as u) {
      <header class="top">
        <div class="wrap row between">
          <nav class="row">
            <a routerLink="/tickets" class="brand">IT Helpdesk</a>
            <a routerLink="/tickets" routerLinkActive="on">{{ session.isStaff() ? 'คิวงาน' : 'เรื่องของฉัน' }}</a>
            @if (session.isStaff()) { <a routerLink="/dashboard" routerLinkActive="on">ภาพรวม</a> }
          </nav>
          <div class="row small">
            <span class="muted">{{ u.name }}</span>
            <button class="btn ghost" (click)="api.logout()">ออกจากระบบ</button>
          </div>
        </div>
      </header>
    }
    <main class="wrap"><router-outlet /></main>
  `,
})
export class App {
  readonly session = inject(Session);
  readonly api = inject(Api);
}
