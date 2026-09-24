// Deklarasi topology A05. Idempoten: aman dipanggil oleh producer, worker,
// maupun tools/siapkan.js. Semua exchange dan queue durable.
//
//   producer --ticket.created--> [support: direct] --> (triage) --> worker
//                                                         | nack(requeue=false)
//                                                         v
//                                    [support.dlx: direct] --rejected--> (triage.rejected)

const TOPOLOGY = {
  exchange: 'support',
  routingKey: 'ticket.created',
  queue: 'triage',
  dlx: 'support.dlx',
  dlqRoutingKey: 'rejected',
  dlq: 'triage.rejected',
};

async function declareTopology(channel) {
  const t = TOPOLOGY;
  await channel.assertExchange(t.dlx, 'direct', { durable: true });
  await channel.assertQueue(t.dlq, { durable: true });
  await channel.bindQueue(t.dlq, t.dlx, t.dlqRoutingKey);

  await channel.assertExchange(t.exchange, 'direct', { durable: true });
  await channel.assertQueue(t.queue, {
    durable: true,
    deadLetterExchange: t.dlx,
    deadLetterRoutingKey: t.dlqRoutingKey,
  });
  await channel.bindQueue(t.queue, t.exchange, t.routingKey);
  return t;
}

module.exports = { TOPOLOGY, declareTopology };
