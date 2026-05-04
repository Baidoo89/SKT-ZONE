import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db.js";
import {
  authorizeActionRequest,
  getAuthStatus,
  isSessionAuthConfigured,
} from "../../../lib/admin-auth.js";

export const runtime = "nodejs";

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapDatabaseError(error) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);

    if (code === "23505") {
      return jsonError("Duplicate reference detected. Use a unique momo reference.", 409);
    }

    if (code === "23514") {
      return jsonError("Request failed database validation checks.", 400);
    }
  }

  return null;
}

function jsonError(message, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isTransientDatabaseError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = String(error.code ?? "");
  return ["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(code);
}

async function readSnapshotWithRetry(pool, attempts = 2) {
  let lastError;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await buildSnapshot(pool);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === attempts) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function buildSnapshot(pool) {
  const [ledgerResult, debtResult, auditResult, auditHistoryResult, summaryResult] = await Promise.all([
    pool.query(
      `select id, entry_time, user_ref, source, amount, processed_by, momo_ref
       from public.reconciliation_ledger
       order by entry_time desc, created_at desc
       limit 200`
    ),
    pool.query(
      `select id, user_ref, display_name, debt_amount, status, priority_rank, created_at
       from public.debit_board
       where status in ('open', 'partial')
       order by debt_amount desc, priority_rank desc, created_at asc
       limit 500`
    ),
    pool.query(
      `select audit_date, total_cash_in, paystack_sync, active_debt_board, match_status, notes, created_at
       from public.reconciliation_audits
       order by created_at desc
       limit 1`
    ),
    pool.query(
      `select id, audit_date, total_cash_in, paystack_sync, active_debt_board, match_status, notes, created_at
       from public.reconciliation_audits
       order by created_at desc
       limit 50`
    ),
    pool.query(
      `select
         coalesce(sum(amount), 0) as cash_in_today,
         case
           when count(*) = 0 then 0
           else round((count(*) filter (where source = 'Paystack')::numeric / count(*)) * 100, 1)
         end as paystack_sync,
         coalesce((select count(*) from public.debit_board where status in ('open', 'partial')), 0) as active_debt_board,
         coalesce((select sum(debt_amount) from public.debit_board where status in ('open', 'partial')), 0) as active_debt_amount,
         coalesce((select count(distinct user_ref) from public.debit_board where status in ('open', 'partial')), 0) as total_debtors
       from public.reconciliation_ledger`
    ),
  ]);

  const ledgerRows = ledgerResult.rows.map((row) => ({
    id: row.id,
    time: new Date(row.entry_time).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    user: row.user_ref,
    source: row.source,
    amount: toNumber(row.amount),
    admin: row.processed_by,
    momoRef: row.momo_ref,
  }));

  const debtors = debtResult.rows.map((row) => ({
    id: row.id,
    user: row.user_ref,
    name: row.display_name,
    debt: toNumber(row.debt_amount),
    status: row.status,
    priorityRank: row.priority_rank,
  }));

  const latestAudit = auditResult.rows[0]
    ? {
        auditDate: auditResult.rows[0].audit_date,
        totalCashIn: toNumber(auditResult.rows[0].total_cash_in),
        paystackSync: toNumber(auditResult.rows[0].paystack_sync),
        activeDebtBoard: Number(auditResult.rows[0].active_debt_board ?? 0),
        matchStatus: auditResult.rows[0].match_status,
        notes: auditResult.rows[0].notes,
      }
    : null;

  return {
    ledgerRows,
    debtors,
    latestAudit,
    auditHistory: auditHistoryResult.rows.map((row) => ({
      id: row.id,
      auditDate: row.audit_date,
      totalCashIn: toNumber(row.total_cash_in),
      paystackSync: toNumber(row.paystack_sync),
      activeDebtBoard: Number(row.active_debt_board ?? 0),
      matchStatus: row.match_status,
      notes: row.notes,
      createdAt: row.created_at,
    })),
    totals: {
      cashInToday: toNumber(summaryResult.rows[0]?.cash_in_today),
      paystackSync: toNumber(summaryResult.rows[0]?.paystack_sync),
      activeDebtBoard: Number(summaryResult.rows[0]?.active_debt_board ?? 0),
      activeDebtAmount: toNumber(summaryResult.rows[0]?.active_debt_amount),
      totalDebtors: Number(summaryResult.rows[0]?.total_debtors ?? 0),
    },
    settings: {
      actionAuthEnabled: Boolean(process.env.ADMIN_ACTION_KEY),
      sessionAuthEnabled: isSessionAuthConfigured(),
    },
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const pool = getPool();

  try {
    const snapshot = await readSnapshotWithRetry(pool);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to load dashboard.", 500);
  }
}

export async function POST(request) {
  const pool = getPool();

  const authError = authorizeActionRequest(request);
  if (authError) {
    return jsonError(authError.error, authError.status);
  }

  try {
    const payload = await request.json();
    const action = payload.action;
    const authStatus = getAuthStatus(request);

    if (action === "topup") {
      const userRef = String(payload.userRef ?? "").trim();
      const momoRef = String(payload.momoRef ?? "").trim();
      const amount = Number(payload.amount ?? 0);
      const processedBy =
        String(payload.processedBy ?? authStatus.user ?? "Admin Desk").trim() ||
        authStatus.user ||
        "Admin Desk";

      if (!userRef || !momoRef || !Number.isFinite(amount) || amount <= 0) {
        return jsonError("Provide a valid user, momo reference, and amount.");
      }

      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query(
          `insert into public.topup_entries (user_ref, amount, momo_ref, credited_by)
           values ($1, $2, $3, $4)`,
          [userRef, amount, momoRef, processedBy]
        );
        await client.query(
          `insert into public.reconciliation_ledger (entry_time, user_ref, source, amount, processed_by, momo_ref)
           values (now(), $1, 'Manual Admin', $2, $3, $4)`,
          [userRef, amount, processedBy, momoRef]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      return NextResponse.json({
        ok: true,
        message: "Wallet credited and logged.",
        snapshot: await readSnapshotWithRetry(pool),
      });
    }

    if (action === "clearDebt") {
      const userRef = String(payload.userRef ?? "").trim();
      const clearAmount = toNumber(payload.amount ?? null);
      const processedBy =
        String(payload.processedBy ?? authStatus.user ?? "Admin Desk").trim() ||
        authStatus.user ||
        "Admin Desk";

      if (!userRef) {
        return jsonError("User reference is required.");
      }

      const client = await pool.connect();

      try {
        await client.query("begin");

        const debtResult = await client.query(
          `select id, user_ref, display_name, debt_amount, status, created_at
           from public.debit_board
           where user_ref = $1 and status in ('open', 'partial')
           order by created_at asc
           for update`,
          [userRef]
        );

        if (debtResult.rowCount === 0) {
          await client.query("rollback");
          return jsonError("Debt record not found.", 404);
        }

        const totalDebtAmount = debtResult.rows.reduce((sum, row) => sum + toNumber(row.debt_amount), 0);

        if (totalDebtAmount <= 0) {
          await client.query("rollback");
          return jsonError("This debtor is already cleared.", 409);
        }

        // Determine amount to clear: if not provided, clear full debt
        const amountToClear =
          Number.isFinite(clearAmount) && clearAmount > 0
            ? Math.min(clearAmount, totalDebtAmount)
            : totalDebtAmount;

        const momoRef = payload.momoRef ? String(payload.momoRef).trim() : `CLR-${userRef}-${Date.now()}`;

        await client.query(
          `insert into public.reconciliation_ledger (entry_time, user_ref, source, amount, processed_by, momo_ref)
           values (now(), $1, 'Debt Clearance', $2, $3, $4)`,
          [userRef, amountToClear, processedBy, momoRef]
        );

        let remainingToClear = amountToClear;

        for (const debtRow of debtResult.rows) {
          if (remainingToClear <= 0) {
            break;
          }

          const rowDebtAmount = toNumber(debtRow.debt_amount);
          if (rowDebtAmount <= 0) {
            continue;
          }

          if (remainingToClear >= rowDebtAmount) {
            await client.query(
              `update public.debit_board
               set status = 'cleared',
                   debt_amount = 0,
                   updated_at = now()
               where id = $1`,
              [debtRow.id]
            );
            remainingToClear -= rowDebtAmount;
          } else {
            await client.query(
              `update public.debit_board
               set status = 'partial',
                   debt_amount = debt_amount - $1,
                   updated_at = now()
               where id = $2`,
              [remainingToClear, debtRow.id]
            );
            remainingToClear = 0;
          }
        }

        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      return NextResponse.json({
        ok: true,
        message: "Debt cleared and logged.",
        snapshot: await readSnapshotWithRetry(pool),
      });
    }

    if (action === "reconcile") {
      const client = await pool.connect();

      try {
        await client.query("begin");

        const summaryResult = await client.query(
          `select
             coalesce(sum(amount), 0) as cash_in_today,
             case
               when count(*) = 0 then 0
               else round((count(*) filter (where source = 'Paystack')::numeric / count(*)) * 100, 1)
             end as paystack_sync
           from public.reconciliation_ledger`
        );

        const activeDebtResult = await client.query(
          `select count(*)::int as active_debt_board
           from public.debit_board
           where status in ('open', 'partial')`
        );

        await client.query(
          `insert into public.reconciliation_audits (
             audit_date,
             total_cash_in,
             paystack_sync,
             active_debt_board,
             match_status,
             notes
           ) values (
             current_date,
             $1,
             $2,
             $3,
             'MATCH',
             $4
           )`,
          [
            summaryResult.rows[0].cash_in_today,
            summaryResult.rows[0].paystack_sync,
            activeDebtResult.rows[0].active_debt_board,
            "Automated UI reconciliation completed.",
          ]
        );

        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      return NextResponse.json({
        ok: true,
        message: "End-of-day reconciliation recorded.",
        snapshot: await buildSnapshot(pool),
      });
    }

    if (action === "createDebt") {
      const userRef = String(payload.userRef ?? "").trim();
      const displayName = String(payload.displayName ?? userRef).trim();
      const amount = Number(payload.amount ?? 0);
      const priorityRank = Number(payload.priorityRank ?? 0) || 0;

      if (!userRef || !Number.isFinite(amount) || amount <= 0) {
        return jsonError("Provide a valid user reference and debt amount.");
      }

      const client = await pool.connect();

      try {
        await client.query("begin");

        const existingDebt = await client.query(
          `select id, debt_amount
           from public.debit_board
           where user_ref = $1 and status in ('open', 'partial')
           order by created_at asc
           limit 1
           for update`,
          [userRef]
        );

        if (existingDebt.rowCount > 0) {
          await client.query(
            `update public.debit_board
             set debt_amount = debt_amount + $1,
                 status = 'partial',
                 display_name = $2,
                 priority_rank = $3,
                 updated_at = now()
             where id = $4`,
            [amount, displayName, priorityRank, existingDebt.rows[0].id]
          );
        } else {
          await client.query(
            `insert into public.debit_board (user_ref, display_name, debt_amount, status, priority_rank, created_at)
             values ($1, $2, $3, 'open', $4, now())`,
            [userRef, displayName, amount, priorityRank]
          );
        }

        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      return NextResponse.json({ ok: true, message: "Debt record created.", snapshot: await readSnapshotWithRetry(pool) });
    }

    if (action === "suggestMatches") {
      const userRef = String(payload.userRef ?? "").trim();
      const amount = toNumber(payload.amount ?? 0);

      const tolerance = Math.max(1, Math.round(amount * 0.1)); // 10% tolerance

      try {
        const matches = await pool.query(
          `select id, entry_time, user_ref, source, amount, momo_ref
           from public.reconciliation_ledger
           where source = 'Paystack' and (
             user_ref ilike $1 or momo_ref ilike $1
           ) and amount between $2 and $3
           order by entry_time desc
           limit 8`,
          [`%${userRef}%`, Math.max(0, amount - tolerance), amount + tolerance]
        );

        const normalized = matches.rows.map((r) => ({
          id: r.id,
          time: r.entry_time,
          user: r.user_ref,
          source: r.source,
          amount: toNumber(r.amount),
          momoRef: r.momo_ref,
        }));

        return NextResponse.json({ ok: true, matches: normalized });
      } catch (error) {
        return jsonError("Failed to fetch suggestions.", 500);
      }
    }

    return jsonError("Unknown action.", 400);
  } catch (error) {
    const mappedDatabaseError = mapDatabaseError(error);
    if (mappedDatabaseError) {
      return mappedDatabaseError;
    }

    return jsonError(error instanceof Error ? error.message : "Request failed.", 500);
  }
}
