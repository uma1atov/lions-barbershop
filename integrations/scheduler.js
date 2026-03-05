/**
 * Планировщик задач — проверяет очередь каждые N секунд
 * Замена Redis/BullMQ для проектов на JSON-хранилище
 */
const cron = require("node-cron");
const config = require("./config");
const jobs = require("./jobs");
const { processPreConfirm, processNoResponse } = require("./notifications");

let isRunning = false;
let schedulerTask = null;

/**
 * Запустить планировщик
 */
function start() {
  if (!config.jobs.enabled) {
    console.log("📋 Планировщик отключён (JOB_WORKER_ENABLED=false)");
    return;
  }

  const interval = config.jobs.checkInterval;

  // Проверять задачи каждые N секунд
  // node-cron: "*/30 * * * * *" = каждые 30 секунд
  const cronExpr = `*/${Math.min(interval, 59)} * * * * *`;

  schedulerTask = cron.schedule(cronExpr, async () => {
    if (isRunning) return; // Не запускать параллельно
    isRunning = true;

    try {
      await processDueJobs();
    } catch (err) {
      console.error("❌ Scheduler error:", err);
    } finally {
      isRunning = false;
    }
  });

  console.log(`⏰ Планировщик запущен (интервал: ${interval}с)`);
}

/**
 * Обработать задачи, готовые к выполнению
 */
async function processDueJobs() {
  const dueJobs = jobs.getDueJobs();
  if (dueJobs.length === 0) return;

  console.log(`📋 Найдено ${dueJobs.length} задач(и) к выполнению`);

  for (const job of dueJobs) {
    try {
      jobs.markRunning(job.id);

      switch (job.kind) {
        case "pre_confirm_30m":
          await processPreConfirm(job);
          break;
        case "no_response_10m":
          await processNoResponse(job);
          break;
        default:
          console.warn(`⚠️  Неизвестный тип задачи: ${job.kind}`);
      }

      jobs.markDone(job.id);
      console.log(`✅ Job ${job.id} (${job.kind}) выполнен`);
    } catch (err) {
      console.error(`❌ Job ${job.id} (${job.kind}) ошибка:`, err.message);
      jobs.markFailed(job.id, err.message);
    }
  }
}

/**
 * Остановить планировщик
 */
function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log("⏰ Планировщик остановлен");
  }
}

module.exports = { start, stop, processDueJobs };
