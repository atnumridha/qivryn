#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
  int fd = open("/Users/amridha/Documents/MOS_Automations/artifacts/mosfs-chrome-agent/logs/native-host-wrapper.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd >= 0) {
    dup2(fd, STDERR_FILENO);
    dprintf(fd, "[native-wrapper] started pid=%d\n", getpid());
  }
  execl("/Users/amridha/.nvm/versions/node/v25.2.1/bin/node", "node", "/Users/amridha/Documents/MOS_Automations/mosfs-chrome-agent/src/native-host/index.mjs", (char *)0);
  perror("exec node failed");
  return 127;
}
